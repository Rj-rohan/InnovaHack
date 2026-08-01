// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title MockUSDC — 6-decimal test stablecoin with an open mint.
/// @notice Deployed alongside the wallet so the demo has a payment token we can mint on demand.
/// Removes any dependency on a token faucet; only ETH for gas still has to come from one.
contract MockUSDC is ERC20 {
    constructor() ERC20("Mock USD Coin", "mUSDC") {}

    /// @dev 6 decimals to match real USDC, so amounts in the dashboard and the agent's prompts
    /// read the way an operator would expect (25_000000 == 25 USDC).
    function decimals() public pure override returns (uint8) {
        return 6;
    }

    /// @notice Unrestricted mint. This is a testnet token with no value — access control here
    /// would only make the demo harder to run.
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
