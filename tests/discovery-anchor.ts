import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { VotingWithDelegation } from "../target/types/voting_with_delegation";

import { expect } from "chai";

describe("voting-with-delegation", () => {
  anchor.setProvider(anchor.AnchorProvider.env());

  const program = anchor.workspace
    .VotingWithDelegation as Program<VotingWithDelegation>;

  let votingStatePDA: anchor.web3.PublicKey;
  let user1: anchor.web3.Keypair;
  let user2: anchor.web3.Keypair;

  before(async () => {
    [votingStatePDA] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("voting_state")],
      program.programId
    );

    user1 = anchor.web3.Keypair.generate();
    user2 = anchor.web3.Keypair.generate();

    await program.provider.connection.requestAirdrop(
      user1.publicKey,
      10 * anchor.web3.LAMPORTS_PER_SOL
    );
    await program.provider.connection.requestAirdrop(
      user2.publicKey,
      10 * anchor.web3.LAMPORTS_PER_SOL
    );
  });

  it("Initializes the voting state", async () => {
    const tx = await program.methods
      .initialize()
      .accountsStrict({
        votingState: votingStatePDA,
        authority: program.provider.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();

    console.log("Your transaction signature", tx);

    const votingStateAccount = await program.account.votingState.fetch(
      votingStatePDA
    );
    expect(votingStateAccount.proposalCount.toNumber()).to.equal(0);
  });

  it("Creates a proposal", async () => {
    const votingStateAccount = await program.account.votingState.fetch(
      votingStatePDA
    );
    const currentProposalCount = votingStateAccount.proposalCount.toNumber();

    const [proposalPDA] = anchor.web3.PublicKey.findProgramAddressSync(
      [
        Buffer.from("proposal"),
        new anchor.BN(currentProposalCount).toArrayLike(Buffer, "le", 8),
      ],
      program.programId
    );

    const tx = await program.methods
      .createProposal("Title", "Test Proposal", new anchor.BN(86400))
      .accountsStrict({
        votingState: votingStatePDA,
        proposal: proposalPDA,
        proposer: program.provider.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();

    console.log("Your transaction signature", tx);

    const proposalAccount = await program.account.proposal.fetch(proposalPDA);
    expect(proposalAccount.id.toNumber()).to.equal(currentProposalCount);
    expect(proposalAccount.description).to.equal("Test Proposal");
    expect(proposalAccount.creator.toString()).to.equal(
      program.provider.publicKey.toString()
    );
    expect(proposalAccount.yesVotes.toNumber()).to.equal(0);
    expect(proposalAccount.noVotes.toNumber()).to.equal(0);
    expect(proposalAccount.status).to.deep.equal({ active: {} });

    const updatedVotingStateAccount = await program.account.votingState.fetch(
      votingStatePDA
    );
    expect(updatedVotingStateAccount.proposalCount.toNumber()).to.equal(
      currentProposalCount + 1
    );
  });

  it("Allows a user to vote and initializes user vote account", async () => {
    const votingStateAccount = await program.account.votingState.fetch(
      votingStatePDA
    );
    const latestProposalId = votingStateAccount.proposalCount.toNumber() - 1;

    const [proposalPDA] = anchor.web3.PublicKey.findProgramAddressSync(
      [
        Buffer.from("proposal"),
        new anchor.BN(latestProposalId).toArrayLike(Buffer, "le", 8),
      ],
      program.programId
    );

    const [userVotePDA] = anchor.web3.PublicKey.findProgramAddressSync(
      [
        Buffer.from("user_vote"),
        user1.publicKey.toBuffer(),
        proposalPDA.toBuffer(),
      ],
      program.programId
    );

    const tx = await program.methods
      .vote({ yes: {} })
      .accountsStrict({
        proposal: proposalPDA,
        userVote: userVotePDA,
        voter: user1.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([user1])
      .rpc();

    console.log("Your transaction signature", tx);

    const proposalAccount = await program.account.proposal.fetch(proposalPDA);
    expect(proposalAccount.yesVotes.toNumber()).to.equal(1);

    const userVoteAccount = await program.account.userVote.fetch(userVotePDA);
    expect(userVoteAccount.hasVoted).to.be.true;
    expect(userVoteAccount.voteType).to.deep.equal({ yes: {} });
  });

  it("Prevents a user from voting twice", async () => {
    const votingStateAccount = await program.account.votingState.fetch(
      votingStatePDA
    );
    const latestProposalId = votingStateAccount.proposalCount.toNumber() - 1;

    const [proposalPDA] = anchor.web3.PublicKey.findProgramAddressSync(
      [
        Buffer.from("proposal"),
        new anchor.BN(latestProposalId).toArrayLike(Buffer, "le", 8),
      ],
      program.programId
    );

    const [userVotePDA] = anchor.web3.PublicKey.findProgramAddressSync(
      [
        Buffer.from("user_vote"),
        user1.publicKey.toBuffer(),
        proposalPDA.toBuffer(),
      ],
      program.programId
    );

    try {
      await program.methods
        .vote({ no: {} })
        .accountsStrict({
          proposal: proposalPDA,
          userVote: userVotePDA,
          voter: user1.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([user1])
        .rpc();
      expect.fail("Expected an error");
    } catch (error) {
      expect(error.toString()).to.include("User has already voted");
    }
  });

  it("Allows a user to delegate voting power and initializes user account", async () => {
    const [user1PDA] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("user"), user1.publicKey.toBuffer()],
      program.programId
    );

    const tx = await program.methods
      .delegate(user2.publicKey)
      .accountsStrict({
        user: user1PDA,
        delegatorAuthority: user1.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([user1])
      .rpc();

    console.log("Your transaction signature", tx);

    const userAccount = await program.account.user.fetch(user1PDA);
    expect(userAccount.delegatedTo?.toString()).to.equal(
      user2.publicKey.toString()
    );
  });

  it("Allows a user to undelegate voting power", async () => {
    const [user1PDA] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("user"), user1.publicKey.toBuffer()],
      program.programId
    );

    const tx = await program.methods
      .undelegate()
      .accountsStrict({
        user: user1PDA,
        userAuthority: user1.publicKey,
      })
      .signers([user1])
      .rpc();

    console.log("Your transaction signature", tx);

    const userAccount = await program.account.user.fetch(user1PDA);
    expect(userAccount.delegatedTo).to.be.null;
  });

  it("Finalizes a proposal", async () => {
    await new Promise((resolve) => setTimeout(resolve, 1000));

    const votingStateAccount = await program.account.votingState.fetch(
      votingStatePDA
    );
    const latestProposalId = votingStateAccount.proposalCount.toNumber() - 1;

    const [proposalPDA] = anchor.web3.PublicKey.findProgramAddressSync(
      [
        Buffer.from("proposal"),
        new anchor.BN(latestProposalId).toArrayLike(Buffer, "le", 8),
      ],
      program.programId
    );

    const tx = await program.methods
      .finalizeProposal()
      .accountsStrict({
        proposal: proposalPDA,
        finalizer: program.provider.publicKey,
      })
      .rpc();

    console.log("Your transaction signature", tx);

    const proposalAccount = await program.account.proposal.fetch(proposalPDA);
    expect(proposalAccount.status).to.deep.equal({ passed: {} });
  });

  it("Prevents voting on a finalized proposal", async () => {
    const votingStateAccount = await program.account.votingState.fetch(
      votingStatePDA
    );
    const latestProposalId = votingStateAccount.proposalCount.toNumber() - 1;

    const [proposalPDA] = anchor.web3.PublicKey.findProgramAddressSync(
      [
        Buffer.from("proposal"),
        new anchor.BN(latestProposalId).toArrayLike(Buffer, "le", 8),
      ],
      program.programId
    );

    const [userVotePDA] = anchor.web3.PublicKey.findProgramAddressSync(
      [
        Buffer.from("user_vote"),
        user2.publicKey.toBuffer(),
        proposalPDA.toBuffer(),
      ],
      program.programId
    );

    try {
      await program.methods
        .vote({ no: {} })
        .accountsStrict({
          proposal: proposalPDA,
          userVote: userVotePDA,
          voter: user2.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([user2])
        .rpc();
      expect.fail("Expected an error");
    } catch (error) {
      expect(error.toString()).to.include("Proposal is not active");
    }
  });
});
