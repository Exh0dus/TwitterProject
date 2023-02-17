import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { doesNotMatch } from "assert";
import { expect } from "chai";
import { assert } from "console";
import { BigNumber } from "ethers";
import { parseEther } from "ethers/lib/utils";
import { ethers } from "hardhat";
import { waitForDebugger } from "inspector";
import { exitCode } from "process";
import { Escrow, Escrow__factory } from "../typechain-types";



describe("Escrow contract tests", async () => {
    let accounts: SignerWithAddress[];
    let contractFactory: Escrow__factory;
    let contract: Escrow;
    const hash = ethers.utils.formatBytes32String("randomHash");
    const msgCost = 0.1;
    const msgCnt = 10;
    const maxOpenContracts = 3;
    const platformFee = 0;
    const addressZero = '0x0000000000000000000000000000000000000000';

    async function getSignerForAccount(idx:number) {
        return ethers.getSigner(accounts[idx].address);
    }

    beforeEach(async () => {
        [accounts, contractFactory] = await
            Promise.all([
                ethers.getSigners(),
                ethers.getContractFactory("Escrow"),
            ]);

        contract = await contractFactory.deploy(platformFee, maxOpenContracts);
        await contract.deployed();
    });

    describe("Contract creation reverts when", async () => {
        it("there is not enough money to cover the costs", async () => {
            await expect(
                contract.createContract(
                    hash,
                    ethers.utils.parseEther(msgCost.toString()),
                    msgCnt,
                    { value: ethers.utils.parseEther((msgCost * 0.1).toString()) }
                )
            ).to.be.revertedWith("Payment insufficient to cover contract costs!");
        });

        it("trying to create more contracts than allowed per Requestor address", async () => {

            for (let i = 0; i < maxOpenContracts; i++) {
                await contract.createContract(
                    ethers.utils.formatBytes32String("randomHash" + i),
                    ethers.utils.parseEther(msgCost.toString()),
                    msgCnt,
                    { value: ethers.utils.parseEther((msgCost * msgCnt).toString()) }
                );
            }

            await expect(
                contract.createContract(
                    hash,
                    ethers.utils.parseEther(msgCost.toString()),
                    msgCnt,
                    { value: ethers.utils.parseEther((msgCost * msgCnt).toString()) }
                )
            ).to.be.revertedWith("Too many active contracts for Requestor!");
        });

        it("there is already a contract defined with the supplied Hash", async () => {

            await contract.createContract(
                hash,
                ethers.utils.parseEther(msgCost.toString()),
                msgCnt,
                { value: ethers.utils.parseEther((msgCost * msgCnt).toString()) }
            )

            await expect(
                contract.createContract(
                    hash,
                    ethers.utils.parseEther(msgCost.toString()),
                    msgCnt,
                    { value: ethers.utils.parseEther((msgCost * msgCnt).toString()) }
                )
            ).to.be.revertedWith("A contract with the supplied Hash already exists!");
        });
    });

    describe("After a contract is created", async () => {

        beforeEach(async () => {
            await contract.createContract(
                hash,
                ethers.utils.parseEther(msgCost.toString()),
                msgCnt,
                { value: ethers.utils.parseEther((msgCost * msgCnt).toString()) }
            )
        });

        it("trying to set the Contractor to the Requestor's address or zero should revert", async () => {
            await expect(contract.setContractor(hash, accounts[0].address)).to.be.revertedWith("Invalid contractor address specified");
            await expect(contract.setContractor(hash, addressZero)).to.be.revertedWith("Invalid contractor address specified");
         });

        it("the Hash is registered for the requestor in activeContracts", async () => {
            let storedHash = await contract.activeContracts(accounts[0].address, 0);
            expect(storedHash).to.be.equal(hash);
        });

        it("after setting the Contractor, the Hash is registered for the contractors in activeContracts", async () => {
            await expect(contract.setContractor(hash, accounts[1].address)).not.to.be.reverted;
            let storedHash = await contract.activeContracts(accounts[1].address, 0);
            expect(storedHash).to.be.equal(hash);
        });

        it("can't change Contractor on already assigned contract", async () => {
            await expect(contract.setContractor(hash, accounts[1].address)).not.to.be.reverted;
            await expect(contract.setContractor(hash, accounts[2].address)).to.be.revertedWith("Cannot assign a contract multiple times!");
        });

        it("contract details can be requested with the Hash from contractLookup", async () => {
            let contractDetails = await contract.contractLookup(hash);

            expect(contractDetails.requestor).to.be.eq(accounts[0].address);
            expect(contractDetails.contractor).to.be.eq(addressZero);
            expect(contractDetails.payoutPerMessage).to.be.eq(ethers.utils.parseEther(msgCost.toString()));
            expect(contractDetails.contractedMessageCount).to.be.eq(msgCnt);
            expect(contractDetails.fulfilledMessageCount).to.be.eq(0);
        });

        it("returns default values for the ContractDetails if the hash is not found", async () => {
            let contractDetails = await contract.contractLookup(ethers.utils.formatBytes32String("wronghash"));

            expect(contractDetails.requestor).to.be.eq(addressZero);
            expect(contractDetails.contractor).to.be.eq(addressZero);
            expect(contractDetails.payoutPerMessage).to.be.eq(ethers.utils.parseEther("0"));
            expect(contractDetails.contractedMessageCount).to.be.eq(0);
            expect(contractDetails.fulfilledMessageCount).to.be.eq(0);
        });

    });

    describe("Pre-approving messages on and Verification", async () => {
        const contractCost = ethers.utils.parseEther((msgCost * msgCnt).toString());
        const msgHash1 = ethers.utils.formatBytes32String("msg1");
        const msgHash2 = ethers.utils.formatBytes32String("msg2");

        beforeEach(async () => {
            await contract.createContract(
                hash,
                ethers.utils.parseEther(msgCost.toString()),
                msgCnt,
                { value: contractCost }
            )
        });

        it("only the requestor can pre-approve", async () => {
            await expect(contract.connect(await getSignerForAccount(2)).addPreApprovedMessages(hash,[msgHash1],[1]))
            .to.be.revertedWith("Only the contract's requestor may run this operation!");

            await expect(contract.addPreApprovedMessages(hash,[msgHash1],[1]))
            .not.to.be.reverted;
        });

        it("length of the input arrays need to match on addPreApprovedMessages", async () => {
            await expect(contract.addPreApprovedMessages(hash, [msgHash1],[1,1]))
            .to.be.revertedWith("The two arrays need to be the same length");
        });

        it("length of the input arrays need to match on verifyMessages", async () => {
            await expect(contract.setVerifier(accounts[3].address)).not.to.be.reverted;
            await expect(contract.connect(await getSignerForAccount(3)).verifyMessages(hash,[msgHash1],[1,1]))
            .to.be.revertedWith("The two arrays need to be the same length");
        });


        it("only verifier can verify messages", async () => {
            await expect(contract.verifyMessages(hash, [msgHash1],[1])).to.be.reverted;
        });

        it("owner can set verifier", async () => {
            await expect(contract.setVerifier(accounts[3].address)).not.to.be.reverted;
            await expect(contract.connect(await getSignerForAccount(3)).verifyMessages(hash, [msgHash1],[1])).not.to.be.reverted;
        });

        it("Verifying pre-approved messages updates fullfilled msg count", async () => {
            await expect(contract.setVerifier(accounts[3].address)).not.to.be.reverted;
            await expect(contract.addPreApprovedMessages(hash,[msgHash1],[1])).not.to.be.reverted;
            await expect(contract.connect(await getSignerForAccount(3)).verifyMessages(hash, [msgHash1],[1])).not.to.be.reverted;

            expect((await contract.contractLookup(hash)).fulfilledMessageCount).to.be.eq(1);
        });


    });

    describe("Contract finalization", async () => {
        const contractCost = ethers.utils.parseEther((msgCost * msgCnt).toString());

        beforeEach(async () => {
            await contract.createContract(
                hash,
                ethers.utils.parseEther(msgCost.toString()),
                msgCnt,
                { value: contractCost }
            )
        });

        it("Requestor finalizing a contract sets the first bit", async () => {
            await expect(contract.setContractor(hash,accounts[1].address)).not.to.be.reverted;
            await expect(contract.finalizeContract(hash)).not.to.be.reverted;
            let details = await contract.contractLookup(hash);
            expect(details.partiesFinalized).to.be.eq(1);
        });

        it("Contactor finalizing a contract sets the second bit", async () => {
            await expect(contract.setContractor(hash,accounts[1].address)).not.to.be.reverted;
            await expect(contract.connect(await getSignerForAccount(1)).finalizeContract(hash)).not.to.be.reverted;
            let details = await contract.contractLookup(hash);
            expect(details.partiesFinalized).to.be.eq(2);
        });

        it("Both parties finalizing sets both bits", async () => {
            await expect(contract.setContractor(hash,accounts[1].address)).not.to.be.reverted;
            await expect(contract.finalizeContract(hash)).not.to.be.reverted;
            await expect(contract.connect(await getSignerForAccount(1)).finalizeContract(hash)).not.to.be.reverted;
            let details = await contract.contractLookup(hash);
            expect(details.partiesFinalized).to.be.eq(3);
        });

        it("Multiple finalizations by the Requestor are handled", async () => {
            await expect(contract.setContractor(hash,accounts[1].address)).not.to.be.reverted;
            await expect(contract.finalizeContract(hash)).not.to.be.reverted;
            await expect(contract.finalizeContract(hash)).not.to.be.reverted;
            await expect(contract.finalizeContract(hash)).not.to.be.reverted;
            let details = await contract.contractLookup(hash);
            expect(details.partiesFinalized).to.be.eq(1);
        });

        it("Multiple finalizations by the Contractor are handled", async () => {
            await expect(contract.setContractor(hash,accounts[1].address)).not.to.be.reverted;
            await expect(contract.connect(await getSignerForAccount(1)).finalizeContract(hash)).not.to.be.reverted;
            await expect(contract.connect(await getSignerForAccount(1)).finalizeContract(hash)).not.to.be.reverted;
            await expect(contract.connect(await getSignerForAccount(1)).finalizeContract(hash)).not.to.be.reverted;
            let details = await contract.contractLookup(hash);
            expect(details.partiesFinalized).to.be.eq(2);
        });

        function aboutAWeekFromNow() {
            return BigNumber.from(Math.floor(Date.now() / 1000 + 600000));
        }

        it("requestor closing an unfinalized contract sets a timeout", async () => {
            await expect(contract.setContractor(hash,accounts[1].address)).not.to.be.reverted;
            await expect(contract.closeContract(hash)).not.to.be.reverted;
            let details = await contract.contractLookup(hash);

            expect(details.canBeClosedAfterEpoch).to.be.greaterThan(aboutAWeekFromNow());
        });

        it("requestor closing a contract finalized by the contractor is instant", async () => {
            await expect(contract.setContractor(hash,accounts[1].address)).not.to.be.reverted;
            await expect(contract.connect(await getSignerForAccount(1)).finalizeContract(hash)).not.to.be.reverted;
            await expect(contract.closeContract(hash)).not.to.be.reverted;
            let details = await contract.contractLookup(hash);
            //requestor being zero on the details means that the data sturcture was cleaned up
            expect(details.requestor).to.be.eq(addressZero);
        });

        it("contractor closing an unfinalized contract sets a timeout", async () => {
            await expect(contract.setContractor(hash,accounts[1].address)).not.to.be.reverted;
            await expect(contract.connect(await getSignerForAccount(1)).closeContract(hash)).not.to.be.reverted;
            let details = await contract.contractLookup(hash);
            expect(details.canBeClosedAfterEpoch).to.be.greaterThan(aboutAWeekFromNow());
        });

        it("contractor closing a contract finalized by the requestor is instant", async () => {
            await expect(contract.setContractor(hash,accounts[1].address)).not.to.be.reverted;
            await expect(contract.finalizeContract(hash)).not.to.be.reverted;
            await expect(contract.connect(await getSignerForAccount(1)).closeContract(hash)).not.to.be.reverted;
            let details = await contract.contractLookup(hash);
            //requestor being zero on the details means that the data sturcture was cleaned up
            expect(details.requestor).to.be.eq(addressZero);
        });

        it("contract can be closed after timeout", async () => {
            await expect(contract.setContractor(hash,accounts[1].address)).not.to.be.reverted;
            await expect(contract.closeContract(hash)).not.to.be.reverted;
            let details = await contract.contractLookup(hash);
            expect(details.canBeClosedAfterEpoch).to.be.greaterThan(aboutAWeekFromNow());

            const blockNumBefore = await ethers.provider.getBlockNumber();
            let blockBefore = await ethers.provider.getBlock(blockNumBefore);
            //mine the next block which is more than a week ahead
            await ethers.provider.send("evm_mine", [blockBefore.timestamp + 700000]);
            blockBefore = await ethers.provider.getBlock(blockNumBefore + 1);

            expect((await contract.getActiveContracts(accounts[0].address)).length).to.be.eq(1);
            await expect(contract.closeContract(hash)).not.to.be.reverted;
            details = await contract.contractLookup(hash);
            expect(details.requestor).to.be.eq(addressZero);
            expect((await contract.getActiveContracts(accounts[0].address))).to.be.empty;
            expect(await contract.withdrawalAmount(accounts[0].address)).to.be.eq(contractCost);
        });
    });

    describe("Closing contract", async () => {
        const contractCost = ethers.utils.parseEther((msgCost * msgCnt).toString());
        const msgHash1 = ethers.utils.formatBytes32String("msg1");

        beforeEach(async () => {
            await contract.createContract(
                hash,
                ethers.utils.parseEther(msgCost.toString()),
                msgCnt,
                { value: contractCost }
            )
        });

        it("non-existent conctract cannot be closed", async () => {
            await expect(contract.closeContract(ethers.utils.formatBytes32String("non-existent")))
            .to.be.revertedWith("The contract requested doesn't exist");
        });

        it("cannot close someone else's contract", async () => {
            await expect(contract.connect(accounts[3])
            .closeContract(hash))
            .to.be.revertedWith("The sender is not involved in this contract!");
        });

        it("closing an unstarted contract refunds the Requestor fully", async () => {
            await expect(contract.closeContract(hash)).not.to.be.reverted;
            //there is no direct return value, so we need to check if the contract data been erased
            expect(await (await contract.contractLookup(hash)).requestor).to.be.eq(addressZero);
            let withdrawBalance = await contract.withdrawalAmount(accounts[0].address);

            expect(withdrawBalance).to.be.eq(contractCost)
        });

        it("closing an unstarted contract cleans up correctly", async () => {
            await expect(contract.closeContract(hash)).not.to.be.reverted;

            expect((await contract.getActiveContracts(accounts[0].address)).length).to.be.eq(0);
            expect((await contract.getActiveContracts(accounts[1].address)).length).to.be.eq(0);
            let details = await contract.contractLookup(hash);
            expect(details.requestor).to.be.eq(addressZero);
        });

        it("closing a finalized distributes money proprtionally", async () => {
            await expect(contract.setVerifier(accounts[3].address)).not.to.be.reverted;
            await expect(contract.setContractor(hash,accounts[1].address)).not.to.be.reverted;
           
            await expect(contract.addPreApprovedMessages(hash,[msgHash1],[5])).not.to.be.reverted;
            await expect(contract.connect(await getSignerForAccount(3)).verifyMessages(hash,[msgHash1],[5])).not.to.be.reverted;
            await expect(contract.finalizeContract(hash)).not.to.be.reverted;//requestor finalizing
            await expect(contract.connect(await getSignerForAccount(1)).finalizeContract(hash)).not.to.be.reverted;//contractor finalizing
            expect((await contract.contractLookup(hash)).partiesFinalized).to.be.eq(3); //done
            await expect(contract.closeContract(hash)).not.to.be.reverted;
 
            expect(await contract.withdrawalAmount(accounts[0].address)).to.be.eq(contractCost.div(2))
            expect(await contract.withdrawalAmount(accounts[1].address)).to.be.eq(contractCost.div(2))
        });


        it("both paries can withdraw", async () => {
            await expect(contract.setVerifier(accounts[3].address)).not.to.be.reverted;
            await expect(contract.setContractor(hash,accounts[1].address)).not.to.be.reverted;
           
            await expect(contract.addPreApprovedMessages(hash,[msgHash1],[5])).not.to.be.reverted;
            await expect(contract.connect(await getSignerForAccount(3)).verifyMessages(hash,[msgHash1],[5])).not.to.be.reverted;
            await expect(contract.finalizeContract(hash)).not.to.be.reverted;//requestor finalizing
            await expect(contract.connect(await getSignerForAccount(1)).finalizeContract(hash)).not.to.be.reverted;//contractor finalizing
            expect((await contract.contractLookup(hash)).partiesFinalized).to.be.eq(3); //done
            await expect(contract.closeContract(hash)).not.to.be.reverted;
 
            expect(await contract.withdrawalAmount(accounts[0].address)).to.be.eq(contractCost.div(2));
            expect(await contract.withdrawalAmount(accounts[1].address)).to.be.eq(contractCost.div(2));

            const withdrawAndCheck = async (accIdx:number) => {
                const prevBalance = await accounts[accIdx].getBalance();
                expect(await contract.connect(accounts[accIdx]).withdraw(contractCost.div(2))).not.to.be.reverted;
                const newBalance = await accounts[accIdx].getBalance();
                expect(newBalance.sub(prevBalance)).to.be.closeTo(contractCost.div(2), parseEther("0.0001"));
            }

            await withdrawAndCheck(0);
            await withdrawAndCheck(1);
            
        });

        it("cannot withdraw without balance", async () => {
            await expect(contract.connect(accounts[0]).withdraw(contractCost.div(2))).to.be.rejectedWith("Not enough balance available!");
            await expect(contract.connect(accounts[1]).withdraw(contractCost.div(2))).to.be.rejectedWith("Not enough balance available!");
        });

        it("closing a started contract cleans up correctly", async () => {
            await expect(contract.setVerifier(accounts[3].address)).not.to.be.reverted;
            await expect(contract.addPreApprovedMessages(hash,[msgHash1],[1])).not.to.be.reverted;
            await expect(contract.connect(await getSignerForAccount(3)).verifyMessages(hash, [msgHash1],[1])).not.to.be.reverted;
            await expect(contract.closeContract(hash)).not.to.be.reverted;

            expect((await contract.getActiveContracts(accounts[0].address)).length).to.be.eq(0);
            expect((await contract.getActiveContracts(accounts[1].address)).length).to.be.eq(0);
            let details = await contract.contractLookup(hash);
            expect(details.requestor).to.be.eq(addressZero);
        });

        it("closing contract cleans up correctly even if there are multiple contracts", async () => {
            for (let i = 0; i < 2; i++) {
                await contract.connect(accounts[0]).createContract(
                    ethers.utils.formatBytes32String("randomHash" + i),
                    ethers.utils.parseEther(msgCost.toString()),
                    msgCnt,
                    { value: ethers.utils.parseEther((msgCost * msgCnt).toString()) }
                );
            }

            await expect(contract.closeContract(hash)).not.to.be.reverted;

            expect((await contract.getActiveContracts(accounts[0].address))).not.to.include.members([hash]);
            expect((await contract.getActiveContracts(accounts[1].address))).not.to.include.members([hash]);
            let details = await contract.contractLookup(hash);
            expect(details.requestor).to.be.eq(addressZero);
        });

    });

    describe("Platform fee", async () => {
        const platformFee = 500; //it is in basis points 500 = 5%
        it("is 0 after the default contract deployment", async () => {
            let storedFee = await contract.platformFee();
            expect(storedFee).to.be.equal(0);
        });

        it("can be changed after contract deployment", async () => {
            await expect(contract.changePlatformFee(platformFee)).not.to.be.reverted;

            let storedFee = await contract.platformFee();
            expect(storedFee).to.be.equal(platformFee);
        });

        it("changed fee applies to contracts initiated afterwards", async () => {
            const cost = msgCost * msgCnt;
            const fee = ethers.utils.parseEther((cost * platformFee / 10000).toString());
            const conractCost = ethers.utils.parseEther(cost.toString());
            await expect(contract.changePlatformFee(platformFee)).not.to.be.reverted;

            await expect(contract.createContract(
                hash,
                ethers.utils.parseEther(msgCost.toString()),
                msgCnt,
                { value: conractCost }
            )).to.be.revertedWith("Payment insufficient to cover contract costs!");

            await expect(contract.createContract(
                hash,
                ethers.utils.parseEther(msgCost.toString()),
                msgCnt,
                { value: conractCost.add(fee) }
            )).not.to.be.reverted;
        });
    });

});