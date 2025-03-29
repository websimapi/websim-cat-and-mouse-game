import * as PIXI from 'pixi.js';
import config from './config.js';

class Game {
    constructor() {
        this.room = new WebsimSocket();
        this.app = null;
        this.gameObjects = {};
        this.players = {};
        this.roles = {
            cat: null,
            mice: {}
        };
        this.keyState = {};
        this.gameActive = false;
        this.gameTimer = null;
        this.timeRemaining = config.gameRules.gameTime;
        this.localPlayerId = null;
        this.obstacles = [];
        this.hidingSpots = [];
        this.cheese = {};
        this.nextCheeseId = 1;
        this.cheeseCooldown = 0;
        this.playerList = document.getElementById('player-list');
        this.gameStatus = document.getElementById('game-status');
        this.roleMessage = document.getElementById('role-message');
        this.catInstructions = document.getElementById('cat-instructions');
        this.mouseInstructions = document.getElementById('mouse-instructions');
        this.damageTimers = {};
        
        this.initialize();
    }

    async initialize() {
        await this.room.initialize();
        this.localPlayerId = this.room.clientId;
        
        this.setupPixi();
        this.setupEventListeners();
        this.startGameIfReady();
        
        this.room.subscribePresence(this.handlePresenceUpdate.bind(this));
        this.room.subscribeRoomState(this.handleRoomStateUpdate.bind(this));
        this.room.subscribePresenceUpdateRequests(this.handlePresenceUpdateRequest.bind(this));
        
        // Initialize room state if not already set
        if (!this.room.roomState.gameStarted) {
            this.room.updateRoomState({
                gameStarted: false,
                gameEnded: false,
                timeRemaining: config.gameRules.gameTime,
                roles: {},
                obstacleLayout: [],
                hidingSpots: [],
                cheese: {}
            });
        }
        
        // Initialize your presence
        this.room.updatePresence({
            x: Math.floor(Math.random() * config.map.width),
            y: Math.floor(Math.random() * config.map.height),
            role: null,
            ready: true,
            health: config.gameRules.mouseStartHealth,
            score: 0,
            dead: false
        });
        
        // Game loop
        this.gameLoop();
    }
    
    setupPixi() {
        this.app = new PIXI.Application({
            width: window.innerWidth,
            height: window.innerHeight,
            backgroundColor: 0x1a1a2e,
            resolution: window.devicePixelRatio || 1,
            autoDensity: true,
            resizeTo: document.getElementById('game-canvas')
        });
        
        document.getElementById('game-canvas').appendChild(this.app.view);
        
        // Create layers
        this.mapLayer = new PIXI.Container();
        this.itemLayer = new PIXI.Container();
        this.playerLayer = new PIXI.Container();
        this.fogLayer = new PIXI.Container();
        
        this.app.stage.addChild(this.mapLayer);
        this.app.stage.addChild(this.itemLayer);
        this.app.stage.addChild(this.playerLayer);
        this.app.stage.addChild(this.fogLayer);
        
        // Create a container for game world
        this.worldContainer = new PIXI.Container();
        this.mapLayer.addChild(this.worldContainer);
        
        // Add timer display
        this.timerDisplay = new PIXI.Text('3:00', {
            fontFamily: 'Arial',
            fontSize: 32,
            fill: 0xffffff,
            align: 'center'
        });
        this.timerDisplay.x = this.app.screen.width / 2;
        this.timerDisplay.y = 40;
        this.timerDisplay.anchor.set(0.5);
        this.app.stage.addChild(this.timerDisplay);
    }
    
    setupEventListeners() {
        // Keyboard events
        window.addEventListener('keydown', (e) => {
            this.keyState[e.code] = true;
        });
        
        window.addEventListener('keyup', (e) => {
            this.keyState[e.code] = false;
        });
        
        // Window resize
        window.addEventListener('resize', () => {
            this.app.renderer.resize(
                document.getElementById('game-canvas').clientWidth,
                document.getElementById('game-canvas').clientHeight
            );
            
            if (this.timerDisplay) {
                this.timerDisplay.x = this.app.screen.width / 2;
                this.timerDisplay.y = 40;
            }
        });
    }
    
    handlePresenceUpdate(presence) {
        this.updatePlayerList();
        this.startGameIfReady();
    }
    
    handleRoomStateUpdate(roomState) {
        if (roomState.gameStarted && !this.gameActive) {
            this.startGame();
        }
        
        if (roomState.gameEnded && this.gameActive) {
            this.endGame();
        }
        
        if (roomState.obstacleLayout && roomState.obstacleLayout.length > 0 && this.obstacles.length === 0) {
            this.createMap(roomState.obstacleLayout, roomState.hidingSpots);
        }
        
        // Update cheese
        if (roomState.cheese) {
            this.updateCheese(roomState.cheese);
        }
        
        // Update timer
        if (roomState.timeRemaining !== undefined) {
            this.updateTimer(roomState.timeRemaining);
        }
    }
    
    handlePresenceUpdateRequest(updateRequest, fromClientId) {
        const ownPresence = this.room.presence[this.localPlayerId];
        
        if (updateRequest.type === 'damage' && !ownPresence.dead) {
            const newHealth = Math.max(0, ownPresence.health - updateRequest.amount);
            const isDead = newHealth <= 0;
            
            this.room.updatePresence({
                health: newHealth,
                dead: isDead
            });
            
            if (isDead) {
                this.showMessage('YOU DIED!');
            }
        }
        
        if (updateRequest.type === 'collectCheese') {
            const newScore = (ownPresence.score || 0) + config.gameRules.cheeseValue;
            this.room.updatePresence({
                score: newScore
            });
        }
    }
    
    updatePlayerList() {
        this.playerList.innerHTML = '';
        
        Object.entries(this.room.peers).forEach(([clientId, peerInfo]) => {
            const playerPresence = this.room.presence[clientId] || {};
            const isCurrentPlayer = clientId === this.localPlayerId;
            
            // Skip players who haven't initialized their presence
            if (!playerPresence.ready) return;
            
            const playerItem = document.createElement('div');
            playerItem.className = 'player-item';
            
            if (playerPresence.role === 'cat') {
                playerItem.classList.add('cat-player');
            } else if (playerPresence.role === 'mouse') {
                playerItem.classList.add('mouse-player');
            }
            
            const avatar = document.createElement('img');
            avatar.src = peerInfo.avatarUrl;
            avatar.className = 'player-avatar';
            
            const nameSpan = document.createElement('span');
            nameSpan.className = 'player-name';
            nameSpan.textContent = peerInfo.username + (isCurrentPlayer ? ' (You)' : '');
            
            playerItem.appendChild(avatar);
            playerItem.appendChild(nameSpan);
            
            // Add score for mice
            if (playerPresence.role === 'mouse' && !playerPresence.dead) {
                const scoreSpan = document.createElement('span');
                scoreSpan.className = 'player-score mouse-score';
                scoreSpan.textContent = `${playerPresence.score || 0}`;
                playerItem.appendChild(scoreSpan);
            }
            
            this.playerList.appendChild(playerItem);
        });
    }
    
    startGameIfReady() {
        // Check if enough players are ready
        const readyPlayers = Object.values(this.room.presence).filter(p => p.ready);
        
        if (readyPlayers.length >= config.gameRules.numberOfMice + 1 && !this.room.roomState.gameStarted) {
            // If I'm the first client, I'll be the game master
            const clientIds = Object.keys(this.room.peers);
            const amIGameMaster = clientIds.sort()[0] === this.localPlayerId;
            
            if (amIGameMaster) {
                const allPlayersIds = Object.keys(this.room.presence).filter(id => this.room.presence[id].ready);
                
                // Randomly select cat
                const catId = allPlayersIds[Math.floor(Math.random() * allPlayersIds.length)];
                const roles = { [catId]: 'cat' };
                
                // Assign mouse role to others
                allPlayersIds.forEach(id => {
                    if (id !== catId) {
                        roles[id] = 'mouse';
                    }
                });
                
                // Generate map layout
                const obstacleLayout = this.generateMapLayout();
                const hidingSpots = this.generateHidingSpots(obstacleLayout);
                
                this.room.updateRoomState({
                    roles: roles,
                    obstacleLayout: obstacleLayout,
                    hidingSpots: hidingSpots,
                    gameStarted: true,
                    gameEnded: false,
                    timeRemaining: config.gameRules.gameTime,
                    cheese: {}
                });
            }
        }
    }
    
    startGame() {
        this.gameActive = true;
        this.gameStatus.textContent = 'Game in progress';
        
        // Set own role
        const myRole = this.room.roomState.roles[this.localPlayerId];
        this.room.updatePresence({
            role: myRole,
            dead: false,
            health: config.gameRules.mouseStartHealth,
            score: 0
        });
        
        // Show role message
        this.showRoleMessage(myRole);
        
        // Start game timer
        if (this.isGameMaster()) {
            this.startGameTimer();
        }
    }
    
    endGame() {
        this.gameActive = false;
        this.gameStatus.textContent = 'Game ended';
        
        // Calculate the winner
        const mice = Object.entries(this.room.presence)
            .filter(([id, presence]) => presence.role === 'mouse');
        
        const aliveMice = mice.filter(([id, presence]) => !presence.dead);
        const catPlayer = Object.entries(this.room.presence)
            .find(([id, presence]) => presence.role === 'cat');
        
        let message = '';
        
        if (this.timeRemaining <= 0) {
            message = 'MICE WIN!';
        } else if (aliveMice.length === 0) {
            message = 'CAT WINS!';
        }
        
        // Display the winner
        this.showMessage(message);
        
        // Show the score
        let highScore = 0;
        let highScorer = null;
        
        mice.forEach(([id, presence]) => {
            if (presence.score > highScore) {
                highScore = presence.score;
                highScorer = id;
            }
        });
        
        if (highScorer) {
            const highScorerName = this.room.peers[highScorer].username;
            setTimeout(() => {
                this.showMessage(`Highest Score: ${highScorerName} - ${highScore}`);
            }, 3000);
        }
    }
    
    showRoleMessage(role) {
        // Update instructions
        this.catInstructions.classList.add('hidden');
        this.mouseInstructions.classList.add('hidden');
        
        if (role === 'cat') {
            this.catInstructions.classList.remove('hidden');
            this.showMessage('YOU ARE THE CAT!');
        } else {
            this.mouseInstructions.classList.remove('hidden');
            this.showMessage('YOU ARE A MOUSE!');
        }
    }
    
    showMessage(text) {
        this.roleMessage.textContent = text;
        this.roleMessage.style.opacity = 1;
        
        setTimeout(() => {
            this.roleMessage.style.opacity = 0;
        }, 3000);
    }
    
    startGameTimer() {
        if (this.gameTimer) {
            clearInterval(this.gameTimer);
        }
        
        this.timeRemaining = config.gameRules.gameTime;
        this.updateTimer(this.timeRemaining);
        
        this.gameTimer = setInterval(() => {
            this.timeRemaining--;
            
            // Update the shared game state with the new time
            this.room.updateRoomState({
                timeRemaining: this.timeRemaining
            });
            
            if (this.timeRemaining <= 0) {
                clearInterval(this.gameTimer);
                this.room.updateRoomState({
                    gameEnded: true
                });
            }
        }, 1000);
    }
    
    updateTimer(time) {
        this.timeRemaining = time;
        const minutes = Math.floor(time / 60);
        const seconds = time % 60;
        this.timerDisplay.text = `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;
    }
    
    generateMapLayout() {
        const obstacles = [];
        const { width, height, wallThickness, obstacleCount, minObstacleWidth, maxObstacleWidth, minObstacleHeight, maxObstacleHeight } = config.map;
        
        // Add boundary walls
        obstacles.push({ x: 0, y: 0, width: width, height: wallThickness }); // Top
        obstacles.push({ x: 0, y: height - wallThickness, width: width, height: wallThickness }); // Bottom
        obstacles.push({ x: 0, y: 0, width: wallThickness, height: height }); // Left
        obstacles.push({ x: width - wallThickness, y: 0, width: wallThickness, height: height }); // Right
        
        // Add random obstacles
        for (let i = 0; i < obstacleCount; i++) {
            const obstacleWidth = Math.floor(Math.random() * (maxObstacleWidth - minObstacleWidth) + minObstacleWidth);
            const obstacleHeight = Math.floor(Math.random() * (maxObstacleHeight - minObstacleHeight) + minObstacleHeight);
            
            // Ensure obstacles are within map boundaries
            const x = Math.floor(Math.random() * (width - obstacleWidth - 2 * wallThickness) + wallThickness);
            const y = Math.floor(Math.random() * (height - obstacleHeight - 2 * wallThickness) + wallThickness);
            
            // Check for overlap with existing obstacles (basic check)
            const tooClose = obstacles.some(obs => {
                return !(x > obs.x + obs.width + 50 || 
                         x + obstacleWidth + 50 < obs.x || 
                         y > obs.y + obs.height + 50 || 
                         y + obstacleHeight + 50 < obs.y);
            });
            
            if (!tooClose) {
                obstacles.push({ x, y, width: obstacleWidth, height: obstacleHeight });
            } else {
                i--; // Try again
            }
        }
        
        return obstacles;
    }
    
    generateHidingSpots(obstacles) {
        const hidingSpots = [];
        const { width, height, wallThickness, hidingSpots: hidingSpotCount } = config.map;
        const hidingSpotSize = 40;
        
        for (let i = 0; i < hidingSpotCount; i++) {
            const x = Math.floor(Math.random() * (width - 2 * wallThickness - hidingSpotSize) + wallThickness);
            const y = Math.floor(Math.random() * (height - 2 * wallThickness - hidingSpotSize) + wallThickness);
            
            // Check for overlap with obstacles
            const overlapping = obstacles.some(obs => {
                return !(x > obs.x + obs.width || 
                         x + hidingSpotSize < obs.x || 
                         y > obs.y + obs.height || 
                         y + hidingSpotSize < obs.y);
            });
            
            // Also check for overlap with other hiding spots
            const tooCloseToOtherSpots = hidingSpots.some(spot => {
                const dx = spot.x - x;
                const dy = spot.y - y;
                return Math.sqrt(dx * dx + dy * dy) < 100; // Minimum distance between hiding spots
            });
            
            if (!overlapping && !tooCloseToOtherSpots) {
                hidingSpots.push({ x, y, size: hidingSpotSize });
            } else {
                i--; // Try again
            }
        }
        
        return hidingSpots;
    }
    
    createMap(obstacleLayout, hidingSpots) {
        this.obstacles = obstacleLayout;
        this.hidingSpots = hidingSpots;
        
        // Clear existing map
        while (this.worldContainer.children.length > 0) {
            this.worldContainer.removeChildAt(0);
        }
        
        // Create obstacles
        obstacleLayout.forEach(obstacle => {
            const graphics = new PIXI.Graphics();
            graphics.beginFill(config.visuals.wallColor);
            graphics.drawRect(obstacle.x, obstacle.y, obstacle.width, obstacle.height);
            graphics.endFill();
            this.worldContainer.addChild(graphics);
        });
        
        // Create hiding spots
        hidingSpots.forEach(spot => {
            const graphics = new PIXI.Graphics();
            graphics.beginFill(config.visuals.hidingSpotColor, 0.5);
            graphics.drawCircle(spot.x + spot.size / 2, spot.y + spot.size / 2, spot.size / 2);
            graphics.endFill();
            this.worldContainer.addChild(graphics);
        });
    }
    
    spawnCheese() {
        if (!this.gameActive || !this.isGameMaster()) return;
        
        const { width, height, wallThickness } = config.map;
        const cheeseSize = config.visuals.cheeseSize;
        
        // Find a valid position for cheese (not inside obstacles)
        let validPosition = false;
        let x, y;
        
        while (!validPosition) {
            x = Math.floor(Math.random() * (width - 2 * wallThickness - cheeseSize) + wallThickness);
            y = Math.floor(Math.random() * (height - 2 * wallThickness - cheeseSize) + wallThickness);
            
            // Check overlap with obstacles
            validPosition = !this.obstacles.some(obs => {
                return !(x > obs.x + obs.width || 
                         x + cheeseSize < obs.x || 
                         y > obs.y + obs.height || 
                         y + cheeseSize < obs.y);
            });
        }
        
        const cheeseId = `cheese-${this.nextCheeseId++}`;
        
        // Update room state with new cheese
        const updatedCheese = {
            ...this.room.roomState.cheese,
            [cheeseId]: { x, y, size: cheeseSize }
        };
        
        this.room.updateRoomState({
            cheese: updatedCheese
        });
    }
    
    updateCheese(cheeseData) {
        // Remove visual representations of deleted cheese
        Object.keys(this.cheese).forEach(id => {
            if (!cheeseData[id]) {
                if (this.cheese[id].sprite) {
                    this.itemLayer.removeChild(this.cheese[id].sprite);
                }
                delete this.cheese[id];
            }
        });
        
        // Add or update cheese
        Object.entries(cheeseData).forEach(([id, data]) => {
            if (!this.cheese[id]) {
                // Create new cheese sprite
                const cheeseSprite = new PIXI.Graphics();
                cheeseSprite.beginFill(config.visuals.cheeseColor);
                cheeseSprite.drawCircle(data.size / 2, data.size / 2, data.size / 2);
                cheeseSprite.endFill();
                cheeseSprite.x = data.x;
                cheeseSprite.y = data.y;
                
                this.cheese[id] = {
                    data: data,
                    sprite: cheeseSprite
                };
                
                this.itemLayer.addChild(cheeseSprite);
            }
        });
    }
    
    checkCheeseCollision(player) {
        if (player.role !== 'mouse' || player.dead) return;
        
        Object.entries(this.cheese).forEach(([id, cheese]) => {
            const dx = player.x - (cheese.data.x + cheese.data.size / 2);
            const dy = player.y - (cheese.data.y + cheese.data.size / 2);
            const distance = Math.sqrt(dx * dx + dy * dy);
            
            if (distance < (player.size / 2 + cheese.data.size / 2)) {
                // Player collected cheese
                if (id === this.localPlayerId) {
                    // If it's our player who collected
                    this.room.updatePresence({
                        score: (player.score || 0) + config.gameRules.cheeseValue
                    });
                } else {
                    // Request other player to update their score
                    this.room.requestPresenceUpdate(id, {
                        type: 'collectCheese'
                    });
                }
                
                // Create collection effect
                this.createCollectionEffect(cheese.data.x, cheese.data.y);
                
                // Remove cheese from game state
                const updatedCheese = { ...this.room.roomState.cheese };
                delete updatedCheese[id];
                
                this.room.updateRoomState({
                    cheese: updatedCheese
                });
            }
        });
    }
    
    createCollectionEffect(x, y) {
        const effect = new PIXI.Graphics();
        effect.beginFill(config.visuals.cheeseColor, 0.7);
        effect.drawCircle(0, 0, 20);
        effect.endFill();
        effect.x = x + 10;
        effect.y = y + 10;
        
        this.itemLayer.addChild(effect);
        
        // Animate and remove
        let alpha = 1;
        let scale = 1;
        
        const animate = () => {
            alpha -= 0.05;
            scale += 0.1;
            
            if (alpha <= 0) {
                this.itemLayer.removeChild(effect);
                return;
            }
            
            effect.alpha = alpha;
            effect.scale.set(scale);
            
            requestAnimationFrame(animate);
        };
        
        animate();
    }
    
    isGameMaster() {
        // The first client is the game master
        const clientIds = Object.keys(this.room.peers).sort();
        return clientIds.length > 0 && clientIds[0] === this.localPlayerId;
    }
    
    gameLoop() {
        // Handle inputs for local player
        this.handlePlayerInput();
        
        // Update all player sprites
        this.updatePlayers();
        
        // Check collisions
        this.checkCollisions();
        
        // Update camera position
        this.updateCamera();
        
        // Cheese cooldown and spawning
        if (this.gameActive && this.isGameMaster()) {
            this.cheeseCooldown -= 1/60;
            if (this.cheeseCooldown <= 0) {
                this.spawnCheese();
                this.cheeseCooldown = config.gameRules.cheeseSpawnRate;
            }
        }
        
        // Request next frame
        requestAnimationFrame(this.gameLoop.bind(this));
    }
    
    handlePlayerInput() {
        if (!this.gameActive || !this.room.presence[this.localPlayerId]) return;
        
        const playerPresence = this.room.presence[this.localPlayerId];
        
        // Don't process input if player is dead
        if (playerPresence.dead) return;
        
        let dx = 0;
        let dy = 0;
        
        if (this.keyState['KeyW'] || this.keyState['ArrowUp']) dy -= 1;
        if (this.keyState['KeyS'] || this.keyState['ArrowDown']) dy += 1;
        if (this.keyState['KeyA'] || this.keyState['ArrowLeft']) dx -= 1;
        if (this.keyState['KeyD'] || this.keyState['ArrowRight']) dx += 1;
        
        // Normalize diagonal movement
        if (dx !== 0 && dy !== 0) {
            const length = Math.sqrt(dx * dx + dy * dy);
            dx /= length;
            dy /= length;
        }
        
        // Apply speed based on role
        const speed = playerPresence.role === 'cat' ? config.gameRules.catSpeed : config.gameRules.mouseSpeed;
        dx *= speed;
        dy *= speed;
        
        // Update position if there's movement
        if (dx !== 0 || dy !== 0) {
            let newX = playerPresence.x + dx;
            let newY = playerPresence.y + dy;
            
            // Collision detection with obstacles
            if (!this.checkObstacleCollision(newX, newY, config.visuals[playerPresence.role === 'cat' ? 'catSize' : 'mouseSize'] / 2)) {
                this.room.updatePresence({
                    x: newX,
                    y: newY
                });
            }
        }
    }
    
    checkObstacleCollision(x, y, radius) {
        return this.obstacles.some(obstacle => {
            // Check if the circle (player) intersects with the rectangle (obstacle)
            const circleDistanceX = Math.abs(x - obstacle.x - obstacle.width / 2);
            const circleDistanceY = Math.abs(y - obstacle.y - obstacle.height / 2);
            
            if (circleDistanceX > (obstacle.width / 2 + radius)) return false;
            if (circleDistanceY > (obstacle.height / 2 + radius)) return false;
            
            if (circleDistanceX <= (obstacle.width / 2)) return true;
            if (circleDistanceY <= (obstacle.height / 2)) return true;
            
            const cornerDistanceSq = Math.pow(circleDistanceX - obstacle.width / 2, 2) +
                                     Math.pow(circleDistanceY - obstacle.height / 2, 2);
            
            return cornerDistanceSq <= Math.pow(radius, 2);
        });
    }
    
    updatePlayers() {
        // Update all players from presence data
        Object.entries(this.room.presence).forEach(([clientId, presence]) => {
            // Skip players without position data
            if (presence.x === undefined || presence.y === undefined || !presence.role) return;
            
            if (!this.players[clientId]) {
                // Create new player sprite
                const isLocalPlayer = clientId === this.localPlayerId;
                const role = presence.role;
                const color = config.visuals[role === 'cat' ? 'catColor' : 'mouseColor'];
                const size = config.visuals[role === 'cat' ? 'catSize' : 'mouseSize'];
                
                // Create player graphics
                const playerGraphics = new PIXI.Graphics();
                this.drawPlayer(playerGraphics, role, size, color);
                
                // Create name tag
                const nameTag = new PIXI.Text(this.room.peers[clientId]?.username || 'Player', {
                    fontFamily: 'Arial',
                    fontSize: 12,
                    fill: 0xffffff,
                    align: 'center'
                });
                nameTag.anchor.set(0.5, 1);
                nameTag.y = -size - 5;
                
                // Create health bar
                const healthBar = new PIXI.Graphics();
                healthBar.y = -size - 10;
                
                // Container for player and nametag
                const container = new PIXI.Container();
                container.addChild(playerGraphics);
                container.addChild(nameTag);
                container.addChild(healthBar);
                
                container.x = presence.x;
                container.y = presence.y;
                
                this.playerLayer.addChild(container);
                
                this.players[clientId] = {
                    sprite: container,
                    graphics: playerGraphics,
                    nameTag: nameTag,
                    healthBar: healthBar,
                    role: role,
                    size: size,
                    color: color,
                    isLocalPlayer: isLocalPlayer
                };
            }
            
            const player = this.players[clientId];
            
            // Update player position
            player.sprite.x = presence.x;
            player.sprite.y = presence.y;
            
            // Update health bar
            if (presence.health !== undefined) {
                const healthPercentage = Math.max(0, presence.health) / config.gameRules.mouseStartHealth;
                const healthWidth = player.size * 1.5;
                
                player.healthBar.clear();
                player.healthBar.beginFill(0xff0000);
                player.healthBar.drawRect(-healthWidth / 2, 0, healthWidth, 5);
                player.healthBar.endFill();
                
                player.healthBar.beginFill(0x00ff00);
                player.healthBar.drawRect(-healthWidth / 2, 0, healthWidth * healthPercentage, 5);
                player.healthBar.endFill();
            }
            
            // Update visibility if player is dead
            if (presence.dead) {
                player.sprite.alpha = 0.4;
            } else {
                player.sprite.alpha = 1;
            }
            
            // Update player object with presence data for collision checks
            Object.assign(player, presence);
        });
        
        // Remove players who are no longer in the presence
        Object.keys(this.players).forEach(clientId => {
            if (!this.room.presence[clientId]) {
                this.playerLayer.removeChild(this.players[clientId].sprite);
                delete this.players[clientId];
            }
        });
    }
    
    drawPlayer(graphics, role, size, color) {
        graphics.clear();
        
        if (role === 'cat') {
            // Draw cat (more triangle like)
            graphics.beginFill(color);
            graphics.drawCircle(0, 0, size / 2);
            
            // Cat ears
            graphics.drawPolygon([
                -size/2, -size/2,
                -size/4, -size,
                0, -size/2
            ]);
            
            graphics.drawPolygon([
                size/2, -size/2,
                size/4, -size,
                0, -size/2
            ]);
            
            graphics.endFill();
            
            // Eyes
            graphics.beginFill(0xffffff);
            graphics.drawCircle(-size/4, -size/4, size/8);
            graphics.drawCircle(size/4, -size/4, size/8);
            graphics.endFill();
            
            // Pupils
            graphics.beginFill(0x000000);
            graphics.drawCircle(-size/4, -size/4, size/16);
            graphics.drawCircle(size/4, -size/4, size/16);
            graphics.endFill();
        } else {
            // Draw mouse (more rounded)
            graphics.beginFill(color);
            graphics.drawCircle(0, 0, size / 2);
            
            // Mouse ears
            graphics.drawCircle(-size/3, -size/3, size/4);
            graphics.drawCircle(size/3, -size/3, size/4);
            
            // Mouse tail
            graphics.lineStyle(size/8, color);
            graphics.moveTo(0, size/2);
            graphics.lineTo(0, size);
            
            graphics.endFill();
            
            // Eyes
            graphics.beginFill(0xffffff);
            graphics.drawCircle(-size/4, -size/6, size/10);
            graphics.drawCircle(size/4, -size/6, size/10);
            graphics.endFill();
            
            // Pupils
            graphics.beginFill(0x000000);
            graphics.drawCircle(-size/4, -size/6, size/20);
            graphics.drawCircle(size/4, -size/6, size/20);
            graphics.endFill();
        }
    }
    
    checkCollisions() {
        if (!this.gameActive) return;
        
        const cat = Object.values(this.players).find(player => player.role === 'cat');
        if (!cat) return;
        
        // Check for cat-mouse collisions
        Object.values(this.players).forEach(mouse => {
            if (mouse.role !== 'mouse' || mouse.dead) return;
            
            const dx = mouse.x - cat.x;
            const dy = mouse.y - cat.y;
            const distance = Math.sqrt(dx * dx + dy * dy);
            
            if (distance < config.gameRules.catchDistance) {
                // Cat is close to mouse
                if (cat.isLocalPlayer) {
                    // Check cooldown for damage
                    const now = Date.now();
                    if (!this.damageTimers[mouse.id] || now - this.damageTimers[mouse.id] > config.gameRules.damageInterval * 1000) {
                        // Cat deals damage to mouse
                        this.room.requestPresenceUpdate(mouse.id, {
                            type: 'damage',
                            amount: config.gameRules.catDamage
                        });
                        
                        this.damageTimers[mouse.id] = now;
                    }
                }
                
                // Highlight the mouse as being caught
                mouse.graphics.clear();
                this.drawPlayer(mouse.graphics, 'mouse', mouse.size, 0xff0000);
                
                // Reset after a short delay
                setTimeout(() => {
                    if (this.players[mouse.id]) {
                        mouse.graphics.clear();
                        this.drawPlayer(mouse.graphics, 'mouse', mouse.size, mouse.color);
                    }
                }, 100);
            }
        });
        
        // Check for mouse-cheese collisions
        const localPlayer = this.players[this.localPlayerId];
        if (localPlayer) {
            this.checkCheeseCollision(localPlayer);
        }
    }
    
    updateCamera() {
        // Center camera on local player
        const localPlayer = this.players[this.localPlayerId];
        if (!localPlayer) return;
        
        const targetX = this.app.screen.width / 2 - localPlayer.x;
        const targetY = this.app.screen.height / 2 - localPlayer.y;
        
        // Smooth camera movement
        this.worldContainer.x = targetX;
        this.worldContainer.y = targetY;
        this.itemLayer.x = targetX;
        this.itemLayer.y = targetY;
        this.playerLayer.x = targetX;
        this.playerLayer.y = targetY;
    }
}

// Start the game
document.addEventListener('DOMContentLoaded', () => {
    new Game();
});

