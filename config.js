// Game configuration settings
const config = {
    // Game rules
    gameRules: {
        numberOfMice: 4,  // How many players will be mice
        gameTime: 180,    // Game time in seconds
        catSpeed: 2.2,    // Cat movement speed
        mouseSpeed: 2.0,  // Mouse movement speed
        cheeseSpawnRate: 5, // Seconds between cheese spawns
        cheeseValue: 10,   // Score value for collecting cheese
        mouseStartHealth: 100,
        catDamage: 20,     // Damage done by cat per hit
        damageInterval: 1,  // Seconds between damage from cat
        catchDistance: 40,  // Distance at which cat can catch mice
    },
    
    // Map configuration
    map: {
        width: 1600,
        height: 1200,
        wallThickness: 20,
        obstacleCount: 15,  // Number of maze-like obstacles
        minObstacleWidth: 50,
        maxObstacleWidth: 200,
        minObstacleHeight: 50,
        maxObstacleHeight: 200,
        hidingSpots: 8,     // Number of special hiding spots for mice
    },
    
    // Visual settings
    visuals: {
        catColor: 0xf06060,
        mouseColor: 0x60acf0,
        wallColor: 0x333333,
        cheeseColor: 0xf8c537,
        hidingSpotColor: 0x008833,
        catSize: 30,
        mouseSize: 20,
        cheeseSize: 15,
        fogOfWarEnabled: true,
        catVisionRadius: 300,
        mouseVisionRadius: 200,
    }
};

export default config;

