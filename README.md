# 🎮 Gamified Perps Trading App

This repository contains the full implementation for a gamified perpetuals trading application built on Starknet, with a Flutter frontend and a Node.js backend.

The vision is to create a game that happens to trade perps, prioritizing fun, engagement, and simplicity over traditional trading features.

## 🚀 Project Structure

* `/backend`: Node.js, Express, and TypeScript services for trading, gamification, and real-time updates.
* `/contracts`: Cairo smart contracts for XP, Achievements, and Leaderboards on Starknet.
* `/frontend`: Flutter application for the mobile user interface.
* `/scripts`: Deployment and utility scripts.
* `/docs`: Project documentation and architecture details.

## 📋 Quick Start

1. **Clone the repository:**
    ```bash
    git clone https://github.com/trungkien1992/gamified-perp-app.git
    cd perps-gamified
    ```

2. **Install Prerequisites:**
    * [Node.js](https://nodejs.org/) (v18+)
    * [Flutter](https://flutter.dev/docs/get-started/install)
    * [Starknet Foundry](https://foundry-rs.github.io/starknet-foundry/)
    * [Docker](https://www.docker.com/get-started)
    * [Redis](https://redis.io/topics/quickstart)

3. **Setup Backend:**
    ```bash
    cd backend
    npm install
    # Configure .env file
    npm run dev
    ```

4. **Setup Frontend:**
    ```bash
    cd frontend
    flutter pub get
    flutter run
    ```

5. **Compile & Deploy Contracts:**
    ```bash
    cd contracts
    snforge build
    snforge deploy ...
    ```

## 🎯 Core Features

* **Backend:**
    * Express API with JWT authentication.
    * Trading service with mock and real (Extended API) modes.
    * XP system with cooldowns and multipliers.
    * Real-time leaderboard using Redis.
    * WebSocket for live UI updates.
    * Queue-based architecture for reliable trade execution.
* **Smart Contracts:**
    * `XPContract`: On-chain XP tracking with batch updates.
    * `AchievementNFT`: ERC721 contract for rewarding user milestones.
    * `LeaderboardContract`: On-chain leaderboard for top traders.
* **Frontend:**
    * Intuitive, swipe-based trading interface.
    * Animated ecosystem visualization for level progression.
    * Real-time XP and level updates via WebSockets.
* **Infrastructure:**
    * Dockerized services for consistent environments.
    * PostgreSQL for persistent data storage.
    * Redis for caching and real-time features.

## 🛣️ Implementation Roadmap

A detailed 4-week implementation plan is available in `docs/ROADMAP.md`.

## 🚨 Emergency Procedures

In case of critical issues, refer to `docs/EMERGENCY.md` for instructions on halting trading, handling database overloads, and managing smart contract incidents.

---

*"Make it simple, make it fun, make it addictive. The rest will follow."*
