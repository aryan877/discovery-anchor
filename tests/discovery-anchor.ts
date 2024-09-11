import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { UniqueLiquidQuadraticGovernance } from "../target/types/unique_liquid_quadratic_governance";
import { expect } from "chai";

describe("unique-liquid-quadratic-governance", () => {
  anchor.setProvider(anchor.AnchorProvider.env());

  const program = anchor.workspace
    .UniqueLiquidQuadraticGovernance as Program<UniqueLiquidQuadraticGovernance>;

  let governancePDA: anchor.web3.PublicKey;
  let governanceBump: number;

  let user1: anchor.web3.Keypair;
  let user2: anchor.web3.Keypair;

  before(async () => {
    [governancePDA, governanceBump] =
      anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("governance")],
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

  it("Initializes the governance", async () => {
    const tx = await program.methods
      .initialize()
      .accountsStrict({
        governance: governancePDA,
        admin: program.provider.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();

    console.log("Your transaction signature", tx);

    const governanceAccount = await program.account.governance.fetch(
      governancePDA
    );
    expect(governanceAccount.admin.toString()).to.equal(
      program.provider.publicKey.toString()
    );
    expect(governanceAccount.proposalCount.toNumber()).to.equal(0);
    expect(governanceAccount.totalBasePower.toNumber()).to.equal(0);
  });

  it("Initializes a user", async () => {
    const governanceAccount = await program.account.governance.fetch(
      governancePDA
    );
    const currentTotalBasePower = governanceAccount.totalBasePower.toNumber();

    const [userPDA] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("user"), user1.publicKey.toBuffer()],
      program.programId
    );

    const tx = await program.methods
      .initializeUser(new anchor.BN(100))
      .accountsStrict({
        user: userPDA,
        userAuthority: user1.publicKey,
        admin: program.provider.publicKey,
        governance: governancePDA,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([user1])
      .rpc();

    console.log("Your transaction signature", tx);

    const userAccount = await program.account.user.fetch(userPDA);
    expect(userAccount.basePower.toNumber()).to.equal(100);
    expect(userAccount.reputation).to.equal(100);
    expect(userAccount.lastVoteTime.toNumber()).to.equal(0);
    expect(userAccount.delegatedTo).to.be.null;

    const updatedGovernanceAccount = await program.account.governance.fetch(
      governancePDA
    );
    expect(updatedGovernanceAccount.totalBasePower.toNumber()).to.equal(
      currentTotalBasePower + 100
    );
  });

  it("Creates a proposal", async () => {
    const governanceAccount = await program.account.governance.fetch(
      governancePDA
    );
    const currentProposalCount = governanceAccount.proposalCount.toNumber();

    const [proposalPDA] = anchor.web3.PublicKey.findProgramAddressSync(
      [
        Buffer.from("proposal"),
        new anchor.BN(currentProposalCount).toArrayLike(Buffer, "le", 8),
      ],
      program.programId
    );

    const tx = await program.methods
      .createProposal("Test Proposal", new anchor.BN(86400))
      .accountsStrict({
        governance: governancePDA,
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

    const updatedGovernanceAccount = await program.account.governance.fetch(
      governancePDA
    );
    expect(updatedGovernanceAccount.proposalCount.toNumber()).to.equal(
      currentProposalCount + 1
    );
  });

  it("Allows a user to vote", async () => {
    const governanceAccount = await program.account.governance.fetch(
      governancePDA
    );
    const latestProposalId = governanceAccount.proposalCount.toNumber() - 1;

    const [userPDA] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("user"), user1.publicKey.toBuffer()],
      program.programId
    );

    const [proposalPDA] = anchor.web3.PublicKey.findProgramAddressSync(
      [
        Buffer.from("proposal"),
        new anchor.BN(latestProposalId).toArrayLike(Buffer, "le", 8),
      ],
      program.programId
    );

    const tx = await program.methods
      .vote({ yes: {} }, new anchor.BN(50))
      .accountsStrict({
        proposal: proposalPDA,
        voter: userPDA,
        voterAuthority: user1.publicKey,
      })
      .signers([user1])
      .rpc();

    console.log("Your transaction signature", tx);

    const proposalAccount = await program.account.proposal.fetch(proposalPDA);
    expect(proposalAccount.yesVotes.toNumber()).to.be.at.least(1);

    const userAccount = await program.account.user.fetch(userPDA);
    expect(userAccount.lastVoteTime.toNumber()).to.be.greaterThan(0);
    expect(userAccount.reputation).to.be.at.least(101);
  });

  it("Allows a user to delegate voting power", async () => {
    const [user1PDA] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("user"), user1.publicKey.toBuffer()],
      program.programId
    );

    const tx = await program.methods
      .delegate(user2.publicKey)
      .accountsStrict({
        user: user1PDA,
        delegatorAuthority: user1.publicKey,
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

    const governanceAccount = await program.account.governance.fetch(
      governancePDA
    );
    const latestProposalId = governanceAccount.proposalCount.toNumber() - 1;

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
        governance: governancePDA,
        finalizer: program.provider.publicKey,
      })
      .rpc();

    console.log("Your transaction signature", tx);

    const proposalAccount = await program.account.proposal.fetch(proposalPDA);
    expect(proposalAccount.status).to.deep.equal({ passed: {} });
  });

  it("Prevents voting on a finalized proposal", async () => {
    const governanceAccount = await program.account.governance.fetch(
      governancePDA
    );
    const latestProposalId = governanceAccount.proposalCount.toNumber() - 1;

    const [userPDA] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("user"), user2.publicKey.toBuffer()],
      program.programId
    );

    const [proposalPDA] = anchor.web3.PublicKey.findProgramAddressSync(
      [
        Buffer.from("proposal"),
        new anchor.BN(latestProposalId).toArrayLike(Buffer, "le", 8),
      ],
      program.programId
    );

    try {
      await program.methods
        .vote({ no: {} }, new anchor.BN(50))
        .accountsStrict({
          proposal: proposalPDA,
          voter: userPDA,
          voterAuthority: user2.publicKey,
        })
        .signers([user2])
        .rpc();
      expect.fail("Expected an error");
    } catch (error) {
      expect(error.toString()).to.include("Proposal is not active");
    }
  });
});
