import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import 'hardhat-watcher';

const config: HardhatUserConfig = {
  solidity: "0.8.17",
  paths: { tests: "tests" },
  watcher: {
    compilation: {
      tasks: ['compile'],
    },
  }
};

export default config;
