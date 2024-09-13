use anchor_lang::prelude::*;

declare_id!("8eCnu6Px3bSjsAdWFN1CYm6y4tYegAJU7Kd5Cy5Tw62R");

#[program]
pub mod voting_with_delegation {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        let voting_state = &mut ctx.accounts.voting_state;
        voting_state.proposal_count = 0;
        Ok(())
    }

    pub fn create_proposal(
        ctx: Context<CreateProposal>,
        title: String,
        description: String,
        voting_period: i64,
    ) -> Result<()> {
        let voting_state = &mut ctx.accounts.voting_state;
        let proposal = &mut ctx.accounts.proposal;

        proposal.id = voting_state.proposal_count;
        proposal.title = title;
        proposal.description = description;
        proposal.creator = ctx.accounts.proposer.key();
        proposal.yes_votes = 0;
        proposal.no_votes = 0;
        proposal.status = ProposalStatus::Active;
        proposal.start_time = Clock::get()?.unix_timestamp;
        proposal.end_time = proposal.start_time + voting_period;

        voting_state.proposal_count += 1;

        Ok(())
    }

    pub fn delegate(ctx: Context<Delegate>, delegate_to: Pubkey) -> Result<()> {
        let user = &mut ctx.accounts.user;
        user.delegated_to = Some(delegate_to);
        Ok(())
    }

    pub fn undelegate(ctx: Context<Undelegate>) -> Result<()> {
        let user = &mut ctx.accounts.user;
        require!(user.delegated_to.is_some(), ErrorCode::NotDelegated);
        user.delegated_to = None;
        Ok(())
    }

    pub fn vote(ctx: Context<Vote>, vote_type: VoteType) -> Result<()> {
        let proposal = &mut ctx.accounts.proposal;
        let user_vote = &mut ctx.accounts.user_vote;
        let clock = Clock::get()?;

        require!(
            proposal.status == ProposalStatus::Active,
            ErrorCode::ProposalNotActive
        );
        require!(
            clock.unix_timestamp >= proposal.start_time,
            ErrorCode::VotingPeriodNotStarted
        );
        require!(
            clock.unix_timestamp <= proposal.end_time,
            ErrorCode::VotingPeriodEnded
        );
        require!(!user_vote.has_voted, ErrorCode::AlreadyVoted);

        match vote_type {
            VoteType::Yes => proposal.yes_votes += 1,
            VoteType::No => proposal.no_votes += 1,
        }

        user_vote.has_voted = true;
        user_vote.vote_type = Some(vote_type);

        emit!(VoteEvent {
            proposal_id: proposal.id,
            voter: *ctx.accounts.voter.key,
            vote_type,
        });

        Ok(())
    }

    pub fn finalize_proposal(ctx: Context<FinalizeProposal>) -> Result<()> {
        let proposal = &mut ctx.accounts.proposal;

        require!(
            Clock::get()?.unix_timestamp > proposal.end_time,
            ErrorCode::VotingPeriodNotEnded
        );
        require!(
            proposal.status == ProposalStatus::Active,
            ErrorCode::ProposalAlreadyFinalized
        );

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
    #[account(init, payer = authority, space = 8 + 8, seeds = [b"voting_state"], bump)]
    pub voting_state: Account<'info, VotingState>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(title: String, description: String)]
pub struct CreateProposal<'info> {
    #[account(mut, seeds = [b"voting_state"], bump)]
    pub voting_state: Account<'info, VotingState>,
    #[account(init, payer = proposer, space = 8 + 8 + 4 + title.len() + 4 + description.len() + 32 + 8 + 8 + 1 + 8 + 8, seeds = [b"proposal", voting_state.proposal_count.to_le_bytes().as_ref()], bump)]
    pub proposal: Account<'info, Proposal>,
    #[account(mut)]
    pub proposer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Delegate<'info> {
    #[account(
        init_if_needed,
        payer = delegator_authority,
        space = 8 + 33,
        seeds = [b"user", delegator_authority.key().as_ref()],
        bump
    )]
    pub user: Account<'info, User>,
    #[account(mut)]
    pub delegator_authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Undelegate<'info> {
    #[account(mut, seeds = [b"user", user_authority.key().as_ref()], bump)]
    pub user: Account<'info, User>,
    pub user_authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct Vote<'info> {
    #[account(mut, seeds = [b"proposal", proposal.id.to_le_bytes().as_ref()], bump)]
    pub proposal: Account<'info, Proposal>,
    #[account(
        init_if_needed,
        payer = voter,
        space = 8 + 1 + 1 + 1,
        seeds = [b"user_vote", voter.key().as_ref(), proposal.key().as_ref()],
        bump
    )]
    pub user_vote: Account<'info, UserVote>,
    #[account(mut)]
    pub voter: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct FinalizeProposal<'info> {
    #[account(mut, seeds = [b"proposal", proposal.id.to_le_bytes().as_ref()], bump)]
    pub proposal: Account<'info, Proposal>,
    pub finalizer: Signer<'info>,
}

#[account]
pub struct VotingState {
    pub proposal_count: u64,
}

#[account]
pub struct Proposal {
    pub id: u64,
    pub title: String,
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
    pub delegated_to: Option<Pubkey>,
}

#[account]
pub struct UserVote {
    pub has_voted: bool,
    pub vote_type: Option<VoteType>,
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
    #[msg("Proposal is not active")]
    ProposalNotActive,
    #[msg("Voting period has not started yet")]
    VotingPeriodNotStarted,
    #[msg("Voting period has ended")]
    VotingPeriodEnded,
    #[msg("Voting period has not ended yet")]
    VotingPeriodNotEnded,
    #[msg("Proposal has already been finalized")]
    ProposalAlreadyFinalized,
    #[msg("User has already voted on this proposal")]
    AlreadyVoted,
    #[msg("User has not delegated their voting power")]
    NotDelegated,
}

#[event]
pub struct VoteEvent {
    pub proposal_id: u64,
    pub voter: Pubkey,
    pub vote_type: VoteType,
}

#[event]
pub struct ProposalFinalizedEvent {
    pub proposal_id: u64,
    pub status: ProposalStatus,
    pub yes_votes: u64,
    pub no_votes: u64,
}
