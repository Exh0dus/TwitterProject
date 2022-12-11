import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { expect } from "chai";
import { BigNumber } from "ethers";
import { parseEther } from "ethers/lib/utils";
import { ethers } from "hardhat";
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
                    accounts[1].address,
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
                    accounts[1].address,
                    ethers.utils.formatBytes32String("randomHash" + i),
                    ethers.utils.parseEther(msgCost.toString()),
                    msgCnt,
                    { value: ethers.utils.parseEther((msgCost * msgCnt).toString()) }
                );
            }

            await expect(
                contract.createContract(
                    accounts[1].address,
                    hash,
                    ethers.utils.parseEther(msgCost.toString()),
                    msgCnt,
                    { value: ethers.utils.parseEther((msgCost * msgCnt).toString()) }
                )
            ).to.be.revertedWith("Too many active contracts for Requestor!");
        });

        it("trying to set the Contractor to the Requestor's address", async () => {
            await expect(
                contract.createContract(
                    accounts[0].address,
                    hash,
                    ethers.utils.parseEther(msgCost.toString()),
                    msgCnt,
                    { value: ethers.utils.parseEther((msgCost * msgCnt).toString()) }
                )
            ).to.be.revertedWith("Can't create a job for yourself");
        });

        it("trying to create more contracts than allowed per Contractor address", async () => {

            for (let i = 0; i < maxOpenContracts; i++) {
                await contract.connect(accounts[i]).createContract(
                    accounts[6].address,
                    ethers.utils.formatBytes32String("randomHash" + i),
                    ethers.utils.parseEther(msgCost.toString()),
                    msgCnt,
                    { value: ethers.utils.parseEther((msgCost * msgCnt).toString()) }
                );
            }

            await expect(
                contract.createContract(
                    accounts[6].address,
                    hash,
                    ethers.utils.parseEther(msgCost.toString()),
                    msgCnt,
                    { value: ethers.utils.parseEther((msgCost * msgCnt).toString()) }
                )
            ).to.be.revertedWith("Too many active contracts for Contractor!");
        });

        it("there is already a contract defined with the supplied Hash", async () => {

            await contract.createContract(
                accounts[1].address,
                hash,
                ethers.utils.parseEther(msgCost.toString()),
                msgCnt,
                { value: ethers.utils.parseEther((msgCost * msgCnt).toString()) }
            )

            await expect(
                contract.createContract(
                    accounts[1].address,
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
                accounts[1].address,
                hash,
                ethers.utils.parseEther(msgCost.toString()),
                msgCnt,
                { value: ethers.utils.parseEther((msgCost * msgCnt).toString()) }
            )
        });

        it("the Hash is registered for the requestor in activeContracts", async () => {
            let storedHash = await contract.activeContracts(accounts[0].address, 0);
            expect(storedHash).to.be.equal(hash);
        });

        it("the Hash is registered for the contractors in activeContracts", async () => {
            let storedHash = await contract.activeContracts(accounts[1].address, 0);
            expect(storedHash).to.be.equal(hash);
        });

        it("contract details can be requested with the Hash from contractLookup", async () => {
            let contractDetails = await contract.contractLookup(hash);

            expect(contractDetails.requestor).to.be.eq(accounts[0].address);
            expect(contractDetails.contractor).to.be.eq(accounts[1].address);
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

    describe("Existing contract finalization", async () => {
        const contractCost = ethers.utils.parseEther((msgCost * msgCnt).toString());

        beforeEach(async () => {
            await contract.createContract(
                accounts[1].address,
                hash,
                ethers.utils.parseEther(msgCost.toString()),
                msgCnt,
                { value: contractCost }
            )
        });

        it("non-existent conctract cannot be finalized", async () => {
            await expect(contract.finalizeContract(ethers.utils.formatBytes32String("non-existent")))
            .to.be.revertedWith("The contract requested doesn't exist");
        });

        it("cannot finalize someone else's contract", async () => {
            await expect(contract.connect(accounts[3])
            .finalizeContract(hash))
            .to.be.revertedWith("The sender is not involved in this contract!");
        });

        it("finalizing an unstarted contract refunds the Requestor fully", async () => {
            await expect(contract.finalizeContract(hash)).not.to.be.reverted;
            let withdrawBalance = await contract.withdrawalAmount(accounts[0].address);

            expect(withdrawBalance).to.be.eq(contractCost)
        });

        it("finalizing an unstarted contract cleans up correctly", async () => {
            await expect(contract.finalizeContract(hash)).not.to.be.reverted;

            expect((await contract.getActiveContracts(accounts[0].address)).length).to.be.eq(0);
            expect((await contract.getActiveContracts(accounts[1].address)).length).to.be.eq(0);
            let details = await contract.contractLookup(hash);
            expect(details.requestor).to.be.eq(addressZero);
        });

        it("finalizing a started contract distributes money proprtionally", async () => {
            await expect(contract.verifyMessages(hash, 5)).not.to.be.reverted;
            await expect(contract.finalizeContract(hash)).not.to.be.reverted;
 
            expect(await contract.withdrawalAmount(accounts[0].address)).to.be.eq(contractCost.div(2))
            expect(await contract.withdrawalAmount(accounts[1].address)).to.be.eq(contractCost.div(2))
        });

        it("finalizing a started contract cleans up correctly", async () => {
            await expect(contract.verifyMessages(hash, 5)).not.to.be.reverted;
            await expect(contract.finalizeContract(hash)).not.to.be.reverted;

            expect((await contract.getActiveContracts(accounts[0].address)).length).to.be.eq(0);
            expect((await contract.getActiveContracts(accounts[1].address)).length).to.be.eq(0);
            let details = await contract.contractLookup(hash);
            expect(details.requestor).to.be.eq(addressZero);
        });

        it("finalizing cleans up correctly even if there are multiple contracts", async () => {
            for (let i = 0; i < 2; i++) {
                await contract.connect(accounts[0]).createContract(
                    accounts[1].address,
                    ethers.utils.formatBytes32String("randomHash" + i),
                    ethers.utils.parseEther(msgCost.toString()),
                    msgCnt,
                    { value: ethers.utils.parseEther((msgCost * msgCnt).toString()) }
                );
            }

            await expect(contract.finalizeContract(hash)).not.to.be.reverted;

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
                accounts[1].address,
                hash,
                ethers.utils.parseEther(msgCost.toString()),
                msgCnt,
                { value: conractCost }
            )).to.be.revertedWith("Payment insufficient to cover contract costs!");

            await expect(contract.createContract(
                accounts[1].address,
                hash,
                ethers.utils.parseEther(msgCost.toString()),
                msgCnt,
                { value: conractCost.add(fee) }
            )).not.to.be.reverted;
        });
    });

});