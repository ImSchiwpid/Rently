import { network } from "hardhat";
import { expect } from "chai";

const { ethers } = await network.create();
const ether = ethers.parseEther;
const evidence = ethers.keccak256(ethers.toUtf8Bytes("evidence-reference"));

async function deploy() {
  const [owner, renter, primary, backup, outsider] = await ethers.getSigners();
  const vault = await ethers.deployContract("RentalVault", [primary.address, backup.address]);
  return { vault, owner, renter, primary, backup, outsider };
}

async function createAgreement(vault: any, owner: any, renter: any, overrides: Record<string, bigint> = {}) {
  const block = await ethers.provider.getBlock("latest");
  const now = BigInt(block!.timestamp);
  const terms = {
    rent: ether("1"),
    deposit: ether("0.5"),
    fundingDeadline: now + 200n,
    handoverNotBefore: now + 2n,
    handoverDeadline: now + 400n,
    rentalDuration: 100n,
    returnGracePeriod: 50n,
    ...overrides,
  };
  await vault.connect(owner).createAgreement(
    renter.address,
    terms.rent,
    terms.deposit,
    terms.fundingDeadline,
    terms.handoverNotBefore,
    terms.handoverDeadline,
    terms.rentalDuration,
    terms.returnGracePeriod,
  );
  return terms;
}

async function fund(vault: any, renter: any, rent = ether("1"), deposit = ether("0.5")) {
  await vault.connect(renter).fund(1, { value: rent + deposit });
}

async function activate(vault: any, owner: any, renter: any, terms?: any) {
  await vault.connect(owner).confirmHandover(1);
  await vault.connect(renter).confirmHandover(1);
  return terms;
}

describe("RentalVault", function () {
  it("validates arbitrators, participants, positive amounts, and dates", async function () {
    const [owner, renter] = await ethers.getSigners();
    await expect(ethers.deployContract("RentalVault", [owner.address, owner.address])).to.be.revertedWith("arbitrators must differ");
    const { vault, primary, backup } = await deploy();
    await expect(ethers.deployContract("RentalVault", [ethers.ZeroAddress, backup.address])).to.be.revertedWith("zero arbitrator");
    const b = await ethers.provider.getBlock("latest");
    const now = BigInt(b!.timestamp);
    await expect(vault.createAgreement(renter.address, 0, 1, now + 30n, now + 2n, now + 40n, 1, 0)).to.be.revertedWith("amounts must be positive");
    await expect(vault.connect(primary).createAgreement(renter.address, 1, 1, now + 30n, now + 2n, now + 40n, 1, 0)).to.be.revertedWith("arbitrator is party");
    await expect(vault.createAgreement(backup.address, 1, 1, now + 30n, now + 2n, now + 40n, 1, 0)).to.be.revertedWith("arbitrator is party");
    await expect(vault.createAgreement(renter.address, 1, 1, now + 30n, now + 40n, now + 30n, 1, 0)).to.be.revertedWith("invalid handover window");
    await vault.createAgreement(renter.address, 1, 1, now + 30n, now - 10n, now + 40n, 1, 0); // past or immediate handoverNotBefore allowed
  });

  it("requires exact renter funding and blocks unauthorized calls", async function () {
    const { vault, owner, renter, outsider } = await deploy();
    await createAgreement(vault, owner, renter);
    await expect(vault.connect(outsider).fund(1, { value: ether("1.5") })).to.be.revertedWith("only renter");
    await expect(vault.connect(renter).fund(1, { value: ether("1") })).to.be.revertedWith("incorrect funding amount");
    await fund(vault, renter);
    expect(await vault.totalEscrow()).to.equal(ether("1.5"));
    await expect(vault.connect(outsider).confirmHandover(1)).to.be.revertedWith("only participant");
  });

  it("starts the rental on the second handover confirmation, credits rent, and keeps deposit escrowed", async function () {
    const { vault, owner, renter } = await deploy();
    const t = await createAgreement(vault, owner, renter);
    await fund(vault, renter);
    await vault.connect(owner).confirmHandover(1);
    expect((await vault.getAgreement(1)).state).to.equal(2n);
    await vault.connect(renter).confirmHandover(1);
    const a = await vault.getAgreement(1);
    expect(a.state).to.equal(3n);
    expect(a.handoverAt).to.be.greaterThan(0n);
    expect(a.rentalEnd - a.handoverAt).to.equal(t.rentalDuration);
    expect(a.returnDeadline - a.rentalEnd).to.equal(t.returnGracePeriod);
    expect(a.escrowRemaining).to.equal(t.deposit);
    expect(await vault.credits(owner.address)).to.equal(t.rent);
    expect(await vault.totalEscrow()).to.equal(t.deposit);
    expect(await vault.totalCredits()).to.equal(t.rent);
  });

  it("settles a mutual return with no deduction and blocks duplicate settlement", async function () {
    const { vault, owner, renter } = await deploy();
    await createAgreement(vault, owner, renter);
    await fund(vault, renter);
    await activate(vault, owner, renter);
    await vault.connect(renter).confirmReturn(1);
    await vault.connect(owner).confirmReturnAndProposeDeduction(1, 0);
    await vault.connect(renter).acceptDeduction(1, 0);
    const a = await vault.getAgreement(1);
    expect(a.state).to.equal(6n);
    expect(a.escrowRemaining).to.equal(0n);
    expect(await vault.credits(renter.address)).to.equal(ether("0.5"));
    expect(await vault.totalEscrow()).to.equal(0n);
    expect(await vault.totalCredits()).to.equal(ether("1.5"));
    await expect(vault.connect(renter).acceptDeduction(1, 0)).to.be.revertedWith("return not mutually confirmed");
  });

  it("requires an exact renter authorization for a bounded partial deduction", async function () {
    const { vault, owner, renter } = await deploy();
    await createAgreement(vault, owner, renter);
    await fund(vault, renter);
    await activate(vault, owner, renter);
    await vault.connect(renter).confirmReturn(1);
    await vault.connect(owner).confirmReturnAndProposeDeduction(1, ether("0.2"));
    await expect(vault.connect(renter).acceptDeduction(1, ether("0.1"))).to.be.revertedWith("amount mismatch");
    await expect(vault.connect(owner).confirmReturnAndProposeDeduction(1, ether("0.6"))).to.be.revertedWith("already confirmed");
    await vault.connect(renter).acceptDeduction(1, ether("0.2"));
    expect(await vault.credits(owner.address)).to.equal(ether("1.2"));
    expect(await vault.credits(renter.address)).to.equal(ether("0.3"));
  });

  it("keeps funds locked after a missed handover deadline until arbitration", async function () {
    const { vault, owner, renter, primary } = await deploy();
    const now = BigInt((await ethers.provider.getBlock("latest"))!.timestamp);
    await createAgreement(vault, owner, renter, { fundingDeadline: now + 100n, handoverDeadline: now + 150n });
    await fund(vault, renter);
    await ethers.provider.send("evm_increaseTime", [160]);
    await ethers.provider.send("evm_mine", []);
    await expect(vault.connect(owner).confirmHandover(1)).to.be.revertedWith("outside handover window");
    await vault.connect(renter).openDispute(1, evidence);
    expect(await vault.totalEscrow()).to.equal(ether("1.5"));
    await vault.connect(primary).arbitrate(1, 0, ether("1.5"));
    expect(await vault.credits(renter.address)).to.equal(ether("1.5"));
    expect((await vault.getAgreement(1)).state).to.equal(9n);
  });

  it("permits an unresolved handover dispute without treating one confirmation as proof", async function () {
    const { vault, owner, renter, primary } = await deploy();
    await createAgreement(vault, owner, renter);
    await fund(vault, renter);
    await vault.connect(owner).confirmHandover(1);
    await vault.connect(renter).openDispute(1, evidence);
    await vault.connect(primary).arbitrate(1, ether("0.5"), ether("1"));
    expect(await vault.credits(owner.address)).to.equal(ether("0.5"));
    expect(await vault.credits(renter.address)).to.equal(ether("1"));
  });

  it("only lets the primary arbitrate during seven days, then the backup", async function () {
    const { vault, owner, renter, primary, backup, outsider } = await deploy();
    await createAgreement(vault, owner, renter);
    await fund(vault, renter);
    await vault.connect(owner).confirmHandover(1);
    await vault.connect(renter).openDispute(1, evidence); // One side confirmed; the other has not.
    await expect(vault.connect(backup).arbitrate(1, 0, ether("1.5"))).to.be.revertedWith("not authorized arbitrator");
    await expect(vault.connect(outsider).arbitrate(1, 0, ether("1.5"))).to.be.revertedWith("not authorized arbitrator");
    await expect(vault.connect(primary).arbitrate(1, 0, ether("1.4"))).to.be.revertedWith("allocation must equal escrow");
    await ethers.provider.send("evm_increaseTime", [7 * 24 * 60 * 60 + 1]);
    await ethers.provider.send("evm_mine", []);
    await expect(vault.connect(primary).arbitrate(1, 0, ether("1.5"))).to.be.revertedWith("not authorized arbitrator");
    await vault.connect(backup).arbitrate(1, 0, ether("1.5"));
    expect((await vault.getAgreement(1)).state).to.equal(9n);
    await expect(vault.connect(backup).arbitrate(1, 0, 0)).to.be.revertedWith("invalid state");
  });

  it("keeps the deposit locked when the return deadline passes without confirmation", async function () {
    const { vault, owner, renter, primary } = await deploy();
    await createAgreement(vault, owner, renter, { rentalDuration: 5n, returnGracePeriod: 5n });
    await fund(vault, renter);
    await activate(vault, owner, renter);
    const deadline = (await vault.getAgreement(1)).returnDeadline;
    const current = BigInt((await ethers.provider.getBlock("latest"))!.timestamp);
    await ethers.provider.send("evm_increaseTime", [Number(deadline - current + 1n)]);
    await ethers.provider.send("evm_mine", []);
    expect((await vault.getAgreement(1)).state).to.equal(3n);
    expect(await vault.totalEscrow()).to.equal(ether("0.5"));
    await vault.connect(renter).openDispute(1, evidence);
    await vault.connect(primary).arbitrate(1, 0, ether("0.5"));
    expect(await vault.credits(renter.address)).to.equal(ether("0.5"));
  });

  it("can arbitrate only the still-locked deposit after rent was credited", async function () {
    const { vault, owner, renter, primary } = await deploy();
    await createAgreement(vault, owner, renter);
    await fund(vault, renter);
    await activate(vault, owner, renter);
    await vault.connect(renter).confirmReturn(1);
    await vault.connect(owner).openDispute(1, evidence);
    await vault.connect(primary).arbitrate(1, ether("0.2"), ether("0.3"));
    expect(await vault.credits(owner.address)).to.equal(ether("1.2"));
    expect(await vault.credits(renter.address)).to.equal(ether("0.3"));
    expect(await vault.totalEscrow()).to.equal(0n);
  });

  it("requires mutual consent for funded pre-handover cancellation and refunds renter by credit", async function () {
    const { vault, owner, renter } = await deploy();
    await createAgreement(vault, owner, renter);
    await fund(vault, renter);
    await vault.connect(renter).consentToFundedCancellation(1);
    expect((await vault.getAgreement(1)).state).to.equal(1n);
    expect(await vault.totalEscrow()).to.equal(ether("1.5"));
    await vault.connect(owner).consentToFundedCancellation(1);
    expect((await vault.getAgreement(1)).state).to.equal(7n);
    expect(await vault.credits(renter.address)).to.equal(ether("1.5"));
    expect(await vault.totalEscrow()).to.equal(0n);
  });

  it("allows a dispute when funded cancellation consent is unresolved", async function () {
    const { vault, owner, renter, primary } = await deploy();
    await createAgreement(vault, owner, renter);
    await fund(vault, renter);
    await vault.connect(renter).consentToFundedCancellation(1);
    await vault.connect(owner).openDispute(1, evidence);
    await vault.connect(primary).arbitrate(1, 0, ether("1.5"));
    expect((await vault.getAgreement(1)).state).to.equal(9n);
    expect(await vault.credits(renter.address)).to.equal(ether("1.5"));
    expect(await vault.totalEscrow()).to.equal(0n);
  });

  it("allows either party to cancel before funding and expires after the funding deadline", async function () {
    const { vault, owner, renter } = await deploy();
    const t = await createAgreement(vault, owner, renter);
    await vault.connect(renter).cancelBeforeFunding(1);
    expect((await vault.getAgreement(1)).state).to.equal(7n);
    await createAgreement(vault, owner, renter, { fundingDeadline: t.fundingDeadline + 50n, handoverDeadline: t.handoverDeadline + 50n });
    await ethers.provider.send("evm_increaseTime", [260]);
    await ethers.provider.send("evm_mine", []);
    await vault.expireUnfunded(2);
    expect((await vault.getAgreement(2)).state).to.equal(8n);
  });

  it("blocks unilateral post-handover cancellation and requires dispute after a return conflict", async function () {
    const { vault, owner, renter, primary } = await deploy();
    await createAgreement(vault, owner, renter);
    await fund(vault, renter);
    await activate(vault, owner, renter);
    await expect(vault.connect(owner).consentToFundedCancellation(1)).to.be.revertedWith("invalid state");
    await vault.connect(renter).confirmReturn(1);
    await vault.connect(owner).openDispute(1, evidence);
    await vault.connect(primary).arbitrate(1, ether("0.25"), ether("0.25"));
    expect(await vault.credits(owner.address)).to.equal(ether("1.25"));
    expect(await vault.credits(renter.address)).to.equal(ether("0.25"));
  });

  it("preserves accounting when a recipient rejects a withdrawal", async function () {
    const { vault, owner, renter } = await deploy();
    const receiver = await ethers.deployContract("RejectingReceiver");
    await createAgreement(vault, owner, { address: receiver.target } as any);
    await receiver.fund(vault.target, 1, { value: ether("1.5") });
    await vault.connect(owner).consentToFundedCancellation(1);
    await receiver.consentToFundedCancellation(vault.target, 1);
    await expect(receiver.withdrawFrom(vault.target, ether("1.5"))).to.be.revertedWith("withdrawal failed");
    expect(await vault.credits(receiver.target)).to.equal(ether("1.5"));
    expect(await vault.totalCredits()).to.equal(ether("1.5"));
    expect(await ethers.provider.getBalance(vault.target)).to.equal(ether("1.5"));
  });

  it("blocks reentrant withdrawals and leaves credits consistent", async function () {
    const { vault, owner } = await deploy();
    const receiver = await ethers.deployContract("ReenteringReceiver");
    const renterAddress = await receiver.getAddress();
    await createAgreement(vault, owner, { address: renterAddress } as any);
    await receiver.fund(vault.target, 1, { value: ether("1.5") });
    await vault.connect(owner).consentToFundedCancellation(1);
    await receiver.consentToFundedCancellation(vault.target, 1);
    await expect(receiver.withdrawFrom(vault.target, ether("1.5"))).to.be.revertedWith("withdrawal failed");
    expect(await vault.credits(renterAddress)).to.equal(ether("1.5"));
    expect(await vault.totalCredits()).to.equal(ether("1.5"));
  });

  it("keeps aggregate liabilities equal to escrow plus user credits", async function () {
    const { vault, owner, renter, primary } = await deploy();
    await createAgreement(vault, owner, renter);
    await fund(vault, renter);
    await activate(vault, owner, renter);
    expect(await ethers.provider.getBalance(vault.target)).to.equal(await vault.totalEscrow() + await vault.totalCredits());
    await vault.connect(renter).confirmReturn(1);
    await vault.connect(owner).openDispute(1, evidence);
    await vault.connect(primary).arbitrate(1, ether("0.2"), ether("0.3"));
    expect(await ethers.provider.getBalance(vault.target)).to.equal(await vault.totalEscrow() + await vault.totalCredits());
  });
});
