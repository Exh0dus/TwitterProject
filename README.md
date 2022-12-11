# TwitterProject

To set the project up on your machine
```
git clone https://github.com/Exh0dus/TwitterProject.git
yarn install
yarn hardhat compile
```

Unit tests can be run from VS Code or via hardhat 
```
yarn hardhat test
```

In this current form this is a proof of concept, testing the viability of the 
data model I've outlined in the design document. It implements the functions dealing 
with data. For further details on what it does and how, refer to the **Unit tests** 
and the **Design Doc** linked below. In it's current form the contract is optimized 
for readability not for gas consumption. 
**Also**, it misses the whole part for verifying messages, that will be an interesting challenge,
but first we need to finalize how we want to go about it. 

[Design document available here](https://docs.google.com/document/d/1wSigQzpjCEbSuFflcBxiup0cKEBFwdCz7KPJ1hVFOek/edit#)

You gonna need to add a .env file before attempting to deploy, as it is not pushed to the repo
Empty .env file example: 

```
MNEMONIC="here is where your twelve words mnemonic should be put my friend"
PRIVATE_KEY="***"
INFURA_API_KEY="***"
INFURA_API_SECRET="***"
ALCHEMY_API_KEY="***"
ETHERSCAN_API_KEY="***"
```

**Note:**
Something seems to be up with the deploy script, will figure that out later