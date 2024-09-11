use anchor_lang::prelude::*;

declare_id!("C4ziZm6dCYNR34EboYmb1KMLMR3NL2y889q6YFQ8mWSz");

#[program]
pub mod discovery_anchor {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        msg!("Greetings from: {:?}", ctx.program_id);
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize {}
