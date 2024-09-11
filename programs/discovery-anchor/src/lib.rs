use anchor_lang::prelude::*;

declare_id!("EHaj8vkVimvsC6Z4nnotUQ6kDf1kC39X2wbaaJxz8jSC");

#[program]
pub mod unique_liquid_quadratic_governance {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        let governance = &mut ctx.accounts.governance;
        governance.admin = ctx.accounts.admin.key();
        governance.proposal_count = 0;
        governance.total_base_power = 0;
        Ok(())
    }

    pub fn initialize_user(ctx: Context<InitializeUser>, initial_base_power: u64) -> Result<()> {
        let user = &mut ctx.accounts.user;
        let governance = &mut ctx.accounts.governance;

        user.base_power = initial_base_power;
        user.reputation = 100;
        user.last_vote_time = 0;
        user.delegated_to = None;

        governance.total_base_power = governance.total_base_power
            .checked_add(initial_base_power)
            .ok_or(ErrorCode::NumericalOverflow)?;

        Ok(())
    }

    pub fn create_proposal(ctx: Context<CreateProposal>, description: String, voting_period: i64) -> Result<()> {
        let governance = &mut ctx.accounts.governance;
        let proposal = &mut ctx.accounts.proposal;

        proposal.id = governance.proposal_count;
        proposal.description = description;
        proposal.creator = ctx.accounts.proposer.key();
        proposal.yes_votes = 0;
        proposal.no_votes = 0;
        proposal.status = ProposalStatus::Active;
        proposal.start_time = Clock::get()?.unix_timestamp;
        proposal.end_time = proposal.start_time + voting_period;

        governance.proposal_count += 1;

        Ok(())
    }

    pub fn delegate(ctx: Context<Delegate>, delegate_to: Pubkey) -> Result<()> {
        let user = &mut ctx.accounts.user;
        require!(user.delegated_to.is_none(), ErrorCode::AlreadyDelegated);
        user.delegated_to = Some(delegate_to);
        Ok(())
    }

    pub fn undelegate(ctx: Context<Undelegate>) -> Result<()> {
        let user = &mut ctx.accounts.user;
        require!(user.delegated_to.is_some(), ErrorCode::NotDelegated);
        user.delegated_to = None;
        Ok(())
    }

    pub fn vote(ctx: Context<Vote>, vote_type: VoteType, voting_power: u64) -> Result<()> {
        let proposal = &mut ctx.accounts.proposal;
        let voter = &mut ctx.accounts.voter;
        let clock = Clock::get()?;

        require!(proposal.status == ProposalStatus::Active, ErrorCode::ProposalNotActive);
        require!(clock.unix_timestamp <= proposal.end_time, ErrorCode::VotingPeriodEnded);
        
        // Calculating effective voting power
        let time_since_last_vote = clock.unix_timestamp - voter.last_vote_time;
        let power_decay = 1.0 - (time_since_last_vote as f64 / (30 * 24 * 60 * 60) as f64).min(1.0);
        let reputation_factor = (voter.reputation as f64 / 100.0).max(0.5).min(1.5);
        let effective_base_power = (voter.base_power as f64 * power_decay * reputation_factor) as u64;

        // Capping the voting power to the effective base power
        let capped_voting_power = voting_power.min(effective_base_power);

        // Applying a quadratic voting formula
        let quadratic_power = ((capped_voting_power as f64).sqrt() * (1.0 + (capped_voting_power as f64 / effective_base_power as f64).ln())) as u64;

        // Ensure quadratic_power is at least 1 if the user is voting
        let quadratic_power = quadratic_power.max(1);

        match vote_type {
            VoteType::Yes => proposal.yes_votes = proposal.yes_votes.checked_add(quadratic_power)
                .ok_or(ErrorCode::NumericalOverflow)?,
            VoteType::No => proposal.no_votes = proposal.no_votes.checked_add(quadratic_power)
                .ok_or(ErrorCode::NumericalOverflow)?,
        }

        // Update the user state post voting
        voter.last_vote_time = clock.unix_timestamp;
        voter.reputation = voter.reputation.saturating_add(1).min(200);

        emit!(VoteEvent {
            proposal_id: proposal.id,
            voter: *voter.to_account_info().key,
            vote_type,
            voting_power: quadratic_power,
            original_voting_power: voting_power,
        });

        Ok(())
    }
    
    pub fn finalize_proposal(ctx: Context<FinalizeProposal>) -> Result<()> {
        let proposal = &mut ctx.accounts.proposal;

        require!(Clock::get()?.unix_timestamp > proposal.end_time, ErrorCode::VotingPeriodNotEnded);
        require!(proposal.status == ProposalStatus::Active, ErrorCode::ProposalAlreadyFinalized);

        proposal.status = if proposal.yes_votes > proposal.no_votes {
            ProposalStatus::Passed
        } else {
            ProposalStatus::Rejected
        };

        emit!(ProposalFinalizedEvent {
            proposal_id: proposal.id,
            status: proposal.status,
            yes_votes: proposal.yes_votes,
            no_votes: proposal.no_votes,
        });

        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(
        init,
        payer = admin,
        space = 8 + 32 + 8 + 8,
        seeds = [b"governance"],
        bump
    )]
    pub governance: Account<'info, Governance>,
    #[account(mut)]
    pub admin: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct InitializeUser<'info> {
    #[account(
        init,
        payer = admin,
        space = 8 + 8 + 1 + 8 + 33,
        seeds = [b"user", user_authority.key().as_ref()],
        bump
    )]
    pub user: Account<'info, User>,
    #[account(mut)]
    pub user_authority: Signer<'info>,
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(
        mut,
        seeds = [b"governance"],
        bump,
        has_one = admin
    )]
    pub governance: Account<'info, Governance>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(description: String)]
pub struct CreateProposal<'info> {
    #[account(mut, seeds = [b"governance"], bump)]
    pub governance: Account<'info, Governance>,
    #[account(
        init,
        payer = proposer,
        space = 8 + 8 + 32 + 4 + description.len() + 32 + 8 + 8 + 1 + 8 + 8,
        seeds = [b"proposal", governance.proposal_count.to_le_bytes().as_ref()],
        bump
    )]
    pub proposal: Account<'info, Proposal>,
    #[account(mut)]
    pub proposer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Delegate<'info> {
    #[account(
        mut,
        seeds = [b"user", delegator_authority.key().as_ref()],
        bump
    )]
    pub user: Account<'info, User>,
    pub delegator_authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct Undelegate<'info> {
    #[account(
        mut,
        seeds = [b"user", user_authority.key().as_ref()],
        bump
    )]
    pub user: Account<'info, User>,
    pub user_authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct Vote<'info> {
    #[account(
        mut,
        seeds = [b"proposal", proposal.id.to_le_bytes().as_ref()],
        bump
    )]
    pub proposal: Account<'info, Proposal>,
    #[account(
        mut,
        seeds = [b"user", voter_authority.key().as_ref()],
        bump
    )]
    pub voter: Account<'info, User>,
    pub voter_authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct FinalizeProposal<'info> {
    #[account(
        mut,
        seeds = [b"proposal", proposal.id.to_le_bytes().as_ref()],
        bump
    )]
    pub proposal: Account<'info, Proposal>,
    #[account(seeds = [b"governance"], bump)]
    pub governance: Account<'info, Governance>,
    pub finalizer: Signer<'info>,
}

#[account]
pub struct Governance {
    pub admin: Pubkey,
    pub proposal_count: u64,
    pub total_base_power: u64,
}

#[account]
pub struct Proposal {
    pub id: u64,
    pub description: String,
    pub creator: Pubkey,
    pub yes_votes: u64,
    pub no_votes: u64,
    pub status: ProposalStatus,
    pub start_time: i64,
    pub end_time: i64,
}

#[account]
pub struct User {
    pub base_power: u64,
    pub reputation: u8,
    pub last_vote_time: i64,
    pub delegated_to: Option<Pubkey>,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum ProposalStatus {
    Active,
    Passed,
    Rejected,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum VoteType {
    Yes,
    No,
}

#[error_code]
pub enum ErrorCode {
    #[msg("Numerical overflow occurred")]
    NumericalOverflow,
    #[msg("Proposal is not active")]
    ProposalNotActive,
    #[msg("Voting period has ended")]
    VotingPeriodEnded,
    #[msg("Voting period has not ended yet")]
    VotingPeriodNotEnded,
    #[msg("Proposal has already been finalized")]
    ProposalAlreadyFinalized,
    #[msg("User has already delegated their voting power")]
    AlreadyDelegated,
    #[msg("User has not delegated their voting power")]
    NotDelegated,
}

#[event]
pub struct VoteEvent {
    pub proposal_id: u64,
    pub voter: Pubkey,
    pub vote_type: VoteType,
    pub voting_power: u64,
    pub original_voting_power: u64,
}

#[event]
pub struct ProposalFinalizedEvent {
    pub proposal_id: u64,
    pub status: ProposalStatus,
    pub yes_votes: u64,
    pub no_votes: u64,
}
