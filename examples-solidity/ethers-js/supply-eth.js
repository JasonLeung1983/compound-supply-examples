/**
 * @fileoverview Executes the contract's interaction with Compound Protocol:
 * 1. Supplies ETH to Compound via MyContract (calls cETH's mint function).
 * 2. Redeems the resulting cETH for the underlying ETH.
 *
 * NOTE: Run 'npx hardhat run scripts/deploy.js --network localhost' prior to this script.
 */
const { ethers } = require('ethers');
const path = require('path');

// --- CONFIGURATION ---

// WARNING: This key is for local testing ONLY. NEVER use a hardcoded key in production.
const PRIVATE_KEY = 'b8c1b5c1d81f9475fdf2e334517d29f733bdfa40682207571b12fc1142cbf329';
// The address of the deployed MyContract (should ideally be read from artifacts).
// NOTE: This must be updated after every local redeployment.
const MY_CONTRACT_ADDRESS = '0x0Bb909b7c3817F8fB7188e8fbaA2763028956E30';
// Mainnet cETH (WETH) address on Compound.
const CETH_ADDRESS = '0x4ddc2d193948926d02f9b1fe9e1daa0718270ed5';
// Amount of ETH to supply (using BigNumber for precision).
const SUPPLY_AMOUNT_ETH = ethers.utils.parseUnits('1', 'ether'); 

// --- SETUP ---
const provider = new ethers.providers.JsonRpcProvider('http://localhost:8545');
const wallet = new ethers.Wallet(PRIVATE_KEY, provider);

// Load MyContract ABI from Hardhat artifacts.
const contractAbiPath = path.join(__dirname, '../../artifacts/contracts/MyContracts.sol/MyContract.json');
const MyContractABI = require(contractAbiPath).abi;

// NOTE ON CETH ABI: In a real project, this ABI should be loaded from a separate file.
const CETH_ABI = [/* ... truncated ABI for brevity ... */]; 

const myContract = new ethers.Contract(MY_CONTRACT_ADDRESS, MyContractABI, wallet);
const cEthContract = new ethers.Contract(CETH_ADDRESS, CETH_ABI, wallet);

// Helper function to convert BigNumber (Wei) to formatted string (ETH).
const formatEther = (bigNumber, decimals = 18) => ethers.utils.formatUnits(bigNumber, decimals);

async function main() {
    console.log(`\n--- Starting Compound Interaction Script ---`);
    console.log(`Wallet Address: ${wallet.address}`);

    // 1. Verify deployment
    const contractCode = await provider.getCode(MY_CONTRACT_ADDRESS);
    if (contractCode === '0x') {
        throw new Error('MyContract is not deployed! Run the deployment script first.');
    }

    // 2. Supply ETH to Compound via MyContract
    console.log(`\n1. Supplying ${formatEther(SUPPLY_AMOUNT_ETH)} ETH to Compound...`);
    
    // We call the wrapper function on MyContract, which forwards the ETH (value) to cETH.mint().
    let tx = await myContract.supplyEthToCompound(
        CETH_ADDRESS,
        { value: SUPPLY_AMOUNT_ETH }
    );
    let supplyResult = await tx.wait(1);
    console.log(`   -> Transaction confirmed. Block: ${supplyResult.blockNumber}`);

    // 3. Check balances after supply
    
    // Check ETH balance supplied to Compound (in underlying units)
    // Using simple contract call instead of callStatic for read-only function.
    const underlyingBalance = await cEthContract.balanceOfUnderlying(MY_CONTRACT_ADDRESS);
    console.log(`   -> MyContract's Underlying ETH Balance (Wei): ${underlyingBalance.toString()}`);
    console.log(`   -> MyContract's Underlying ETH Balance (ETH): ${formatEther(underlyingBalance)}`);

    // Check cETH Token balance
    const cTokenBalance = await cEthContract.balanceOf(MY_CONTRACT_ADDRESS);
    console.log(`   -> MyContract's cETH Token Balance (cTokens): ${formatEther(cTokenBalance, 8)}`); 
    
    // Ensure we have cTokens to redeem
    if (cTokenBalance.isZero()) {
        throw new Error("cETH balance is zero after supply, cannot proceed with redeem.");
    }

    // 4. Redeem the cETH for underlying ETH
    console.log(`\n2. Redeeming all cETH for underlying ETH...`);
    
    // We choose to redeem based on the cToken amount received.
    const amountToRedeem = cTokenBalance; // BigNumber
    const redeemByCToken = true;

    // Call the wrapper function on MyContract
    tx = await myContract.redeemCEth(
        amountToRedeem,
        redeemByCToken,
        CETH_ADDRESS
    );
    let redeemResult = await tx.wait(1);
    console.log(`   -> Redeem transaction confirmed. Block: ${redeemResult.blockNumber}`);

    // Check the return code from the Compound CToken contract (event Failure is indexed as 4 in the original script)
    const failureEvent = redeemResult.events.find(e => e.event === 'Failure');
    if (failureEvent && !failureEvent.args[1].isZero()) {
         throw new Error('Redeem Error Code: ' + failureEvent.args[1].toString());
    }
    
    // 5. Check final balances
    const finalCTokenBalance = await cEthContract.balanceOf(MY_CONTRACT_ADDRESS);
    console.log(`\nFinal Balances Check:`);
    console.log(`   -> MyContract's Final cETH Token Balance: ${formatEther(finalCTokenBalance, 8)}`);

    const finalEthBalance = await provider.getBalance(MY_CONTRACT_ADDRESS);
    console.log(`   -> MyContract's Final ETH Balance (ETH): ${formatEther(finalEthBalance)}`);
}

main().catch((err) => {
    // Standard error handling using console.error
    console.error(`\n--- Script Failed ---`);
    console.error(err);
    process.exit(1);
});
