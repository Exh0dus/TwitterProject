import { ethers } from "hardhat";
import { Escrow__factory } from "../typechain-types";
import * as dotevn from 'dotenv';

dotevn.config();

async function main() {
    const provider = ethers.getDefaultProvider("goerli", { alchemy: process.env.ALCHEMY_API_KEY }); //needs api key in the options so it won't get rate limited, but it can read without a wallet
    const wallet = new ethers.Wallet(process.env.PRIVATE_KEY);
    const signer = wallet.connect(provider);
    const maxOpenContracts = 3;
    const platformFee = 0;

    const tokenFactory = new Escrow__factory(signer); 
    const tokenContract = await tokenFactory.deploy(platformFee, maxOpenContracts);
    await tokenContract.deployed();

    console.log("token contract deployed at: ", tokenContract.address);

}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
