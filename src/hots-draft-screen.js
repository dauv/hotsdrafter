// Nodejs dependencies
const { TesseractWorker, TesseractUtils, ...TesseractTypes } = require('tesseract.js');
const worker = new TesseractWorker();
const jimp = require('jimp');
const path = require('path');
const fs = require('fs');
const EventEmitter = require('events');

// Local classes
const HotsDraftTeam = require('./hots-draft-team.js');
const HotsDraftPlayer = require('./hots-draft-player.js');
const HotsHelpers = require('./hots-helpers.js');

// Data files
const DraftLayout = require('../data/draft-layout');

class HotsDraftScreen extends EventEmitter {

    constructor(app) {
        super();
        this.app = app;
        this.updateActive = false;
        this.tessLangs = "eng";
        this.tessParams = {
            tessedit_pageseg_mode: TesseractTypes.PSM.SINGLE_LINE
        };
        this.generateDebugFiles = false;
        this.offsets = {};
        this.banImages = null;
        this.banActive = false;
        this.screenshot = null;
        this.map = null;
        this.teams = [];
        this.teamActive = null;
        // Update handling
        this.on("update.started", () => {
            this.updateActive = true;
        });
        this.on("update.done", () => {
            this.updateActive = false;
        });
        this.on("update.failed", () => {
            // Nothing yet
        });
    }
    loadOffsets() {
        let baseSize = DraftLayout["screenSizeBase"];
        let targetSize = { "x": this.screenshot.bitmap.width, "y": this.screenshot.bitmap.height };
        this.offsets["mapSize"] = HotsHelpers.scaleOffset(DraftLayout["mapSize"], baseSize, targetSize);
        this.offsets["mapPos"] = HotsHelpers.scaleOffset(DraftLayout["mapPos"], baseSize, targetSize);
        this.offsets["banSize"] = HotsHelpers.scaleOffset(DraftLayout["banSize"], baseSize, targetSize);
        this.offsets["banSizeCompare"] = HotsHelpers.scaleOffset(DraftLayout["banSizeCompare"], baseSize, targetSize);
        this.offsets["banCheckSize"] = HotsHelpers.scaleOffset(DraftLayout["banCheckSize"], baseSize, targetSize);
        this.offsets["banCropSize"] = HotsHelpers.scaleOffset(DraftLayout["banCropSize"], baseSize, targetSize);
        this.offsets["timerPos"] = HotsHelpers.scaleOffset(DraftLayout["timerPos"], baseSize, targetSize);
        this.offsets["timerSize"] = HotsHelpers.scaleOffset(DraftLayout["timerSize"], baseSize, targetSize);
        this.offsets["playerSize"] = HotsHelpers.scaleOffset(DraftLayout["playerSize"], baseSize, targetSize);
        this.offsets["nameSize"] = HotsHelpers.scaleOffset(DraftLayout["nameSize"], baseSize, targetSize);
        this.offsets["nameHeroSizeRotated"] = HotsHelpers.scaleOffset(DraftLayout["nameHeroSizeRotated"], baseSize, targetSize);
        this.offsets["namePlayerSizeRotated"] = HotsHelpers.scaleOffset(DraftLayout["namePlayerSizeRotated"], baseSize, targetSize);
        this.offsets["teams"] = {};
        for (let team in DraftLayout["teams"]) {
            let players = [];
            for (let i = 0; i < DraftLayout["teams"][team]["players"].length; i++) {
                players.push(HotsHelpers.scaleOffset(DraftLayout["teams"][team]["players"][i], baseSize, targetSize));
            }
            let bans = [];
            for (let i = 0; i < DraftLayout["teams"][team]["bans"].length; i++) {
                bans.push(HotsHelpers.scaleOffset(DraftLayout["teams"][team]["bans"][i], baseSize, targetSize));
            }
            this.offsets["teams"][team] = {
                "players": players,
                "bans": bans,
                "banCheck": HotsHelpers.scaleOffset(DraftLayout["teams"][team]["banCheck"], baseSize, targetSize),
                "banCropPos": HotsHelpers.scaleOffset(DraftLayout["teams"][team]["banCropPos"], baseSize, targetSize),
                "name": HotsHelpers.scaleOffset(DraftLayout["teams"][team]["name"], baseSize, targetSize),
                "nameHeroRotated": HotsHelpers.scaleOffset(DraftLayout["teams"][team]["nameHeroRotated"], baseSize, targetSize),
                "namePlayerRotated": HotsHelpers.scaleOffset(DraftLayout["teams"][team]["namePlayerRotated"], baseSize, targetSize)
            };
        }
    }
    loadBanImages() {
        return new Promise((resolve, reject) => {
            if (this.banImages !== null) {
                resolve(true);
                return;
            }
            this.banImages = {};
            // Create cache directory if it does not exist
            let storageDir = HotsHelpers.getStorageDir();
            let banHeroDir = path.join(storageDir, "bans");
            if (!fs.existsSync( banHeroDir )) {
                fs.mkdirSync(banHeroDir, { recursive: true });
            }
            const directoryPathBase = path.join(__dirname, "..", "data", "bans");
            const directoryPathUser = banHeroDir;
            this.loadBanImagesFromDir(directoryPathBase).then(() => {
                return this.loadBanImagesFromDir(directoryPathUser);
            }).then(() => {
                resolve(true);
            }).catch((error) => {
                reject(error);
            });
        });
    }
    loadBanImagesFromDir(directoryPath) {
        return new Promise((resolve, reject) => {
            fs.readdir(directoryPath, (errorMessage, files) => {
                if (errorMessage) {
                    reject(new Error('Unable to scan directory: ' + errorMessage));
                    return;
                }
                let loadPromises = [];
                files.forEach((file) => {
                    let match = file.match(/^(.+)\.png$/);
                    if (match) {
                        // Load image
                        let heroName = match[1];
                        loadPromises.push(
                            jimp.read(directoryPath+"/"+file).then(async (image) => {
                                this.banImages[heroName] = image.resize(this.offsets["banSizeCompare"].x, this.offsets["banSizeCompare"].y);
                            })
                        );
                    }
                });
                if (loadPromises.length === 0) {
                    resolve(true);
                } else {
                    Promise.all(loadPromises).then(() => {
                        resolve(true);
                    }).catch((error) => {
                        reject(error);
                    });
                }
            });
        });
    }
    saveHeroBanImage(heroName, banImageBase64) {
        if (!this.banImages.hasOwnProperty(heroName)) {
            let buffer = Buffer.from(banImageBase64.substr( banImageBase64.indexOf("base64,") + 7 ), 'base64');
            jimp.read(buffer).then((image) => {
                let banHeroFile = path.join(HotsHelpers.getStorageDir(), "bans", heroName+".png");
                image.write(banHeroFile);
                this.banImages[heroName] = image;
            });
        }
    }
    debug(generateDebugFiles) {
        this.generateDebugFiles = generateDebugFiles;
    }
    clear() {
        this.map = null;
        this.teams = [];
        this.emit("change");
    }
    detect(screenshotFile) {
        // Start detection
        return new Promise((resolve, reject) => {
            if (this.updateActive) {
                resolve(false);
                return;
            }
            this.emit("detect.start");
            jimp.read(screenshotFile).then((screenshot) => {
                // Screenshot file loaded
                this.screenshot = screenshot;
                this.emit("detect.screenshot.load.success");
                // Load offsets
                this.loadOffsets();
                // Load images for detecting banned heroes (if not already loaded)
                return this.loadBanImages();
            }).then(() => {
                this.emit("detect.ban.images.load.success");
                // Detect map text (will invoke "detectTimer" on success)
                this.emit("detect.map.start");
                return this.detectMap();
            }).then(() => {
                // Success
                this.emit("detect.map.success");
                this.emit("change");
                this.emit("detect.timer.start");
                return this.detectTimer();
            }).then(() => {
                // Success
                this.emit("detect.timer.success");
                this.emit("change");
                // Teams
                this.emit("detect.teams.start");
                if (this.teams.length === 0) {
                    // Teams not yet detected
                    return this.detectTeams();
                } else {
                    // Update teams
                    return this.updateTeams();
                }
            }).then((result) => {
                this.emit("detect.teams.success");
                this.emit("detect.success");
                this.emit("detect.done");
                resolve(result);
            }).catch((error) => {
                // Error in the detection chain
                this.emit("detect.error", error);
                this.emit("detect.done");
                reject(error);
            });
        });
    }
    detectMap() {
        return new Promise((resolve, reject) => {
            let mapPos = this.offsets["mapPos"];
            let mapSize = this.offsets["mapSize"];
            let mapNameImg = this.screenshot.clone().crop(mapPos.x, mapPos.y, mapSize.x, mapSize.y);
            // Cleanup and trim map name
            if (!HotsHelpers.imageCleanupName(mapNameImg, DraftLayout["colors"]["mapName"])) {
                reject(new Error("No map text found at the expected location!"));
                return;
            }
            // Convert to black on white for optimal detection
            mapNameImg.greyscale().contrast(0.4).normalize().blur(1).invert();
            if (this.generateDebugFiles) {
                // Debug output
                mapNameImg.write("debug/mapName.png");
            }
            // Detect map name using tesseract
            mapNameImg.getBufferAsync(jimp.MIME_PNG).then((buffer) => {
                worker.recognize(buffer, this.tessLangs, this.tessParams).then((result) => {
                    let mapName = this.app.gameData.fixMapName( result.text.trim() );
                    if ((mapName !== "") && (this.app.gameData.mapExists(mapName))) {
                        this.setMap(mapName);
                        resolve(true);
                    } else {
                        reject(new Error("Map name could not be detected!"));
                    }
                }).catch((error) => {
                    reject(error);
                });
            });
        });
    }
    detectTimer() {
        return new Promise(async (resolve, reject) => {
            let timerPos = this.offsets["timerPos"];
            let timerSize = this.offsets["timerSize"];
            let timerImg = this.screenshot.clone().crop(timerPos.x, timerPos.y, timerSize.x, timerSize.y).scale(0.5);
            if (this.generateDebugFiles) {
                // Debug output
                timerImg.write("debug/pickTimer.png");
            }
            if (HotsHelpers.imageFindColor(timerImg, DraftLayout["colors"]["timer"]["blue"])) {
                // Blue team active
                this.teamActive = "blue";
                this.banActive = false;
                resolve(true);
                return;
            } else if (HotsHelpers.imageFindColor(timerImg, DraftLayout["colors"]["timer"]["red"])) {
                // Red team active
                this.teamActive = "red";
                this.banActive = false;
                resolve(true);
                return;
            } else if (HotsHelpers.imageFindColor(timerImg, DraftLayout["colors"]["timer"]["ban"])) {
                // Banning, check which team is banning
                let sizeBanCheck = this.offsets["banCheckSize"];
                for (let color in this.offsets["teams"]) {
                    // Get offsets
                    let teamOffsets = this.offsets["teams"][color];
                    let posBanCheck = teamOffsets["banCheck"];
                    // Check bans
                    let banCheckImg = this.screenshot.clone().crop(posBanCheck.x, posBanCheck.y, sizeBanCheck.x, sizeBanCheck.y).scale(0.5);
                    if (this.generateDebugFiles) {
                        // Debug output
                        banCheckImg.write("debug/"+color+"_banCheck.png");
                    }
                    if (HotsHelpers.imageFindColor(banCheckImg, DraftLayout["colors"]["banActive"])) {
                        this.teamActive = color;
                        this.banActive = true;
                        resolve(true);
                        return;
                    }
                }
            }
            this.teamActive = null;
            reject(new Error("Failed to detect pick counter"));
        });
    }
    detectTeams() {
        return new Promise(async (resolve, reject) => {
            let teamDetections = [
                this.detectTeam("blue"),
                this.detectTeam("red")
            ];
            Promise.all(teamDetections).then(() => {
                resolve(true);
            }).catch((error) => {
                reject(error);
            });
        });
    }
    updateTeams() {
        return new Promise(async (resolve, reject) => {
            for (let t = 0; t < this.teams.length; t++) {
                let team = this.teams[t];
                let players = team.getPlayers();
                let detections = [];
                // Bans
                detections.push( this.detectBans(team) );
                // Players
                for (let i = 0; i < players.length; i++) {
                    let player = players[i];
                    if (!player.isLocked()) {
                        detections.push( this.detectPlayer(player) );
                    }
                }
                Promise.all(detections).then(() => {
                    resolve(true);
                });
            }
        });
    }
    detectTeam(color) {
        return new Promise(async (resolve, reject) => {
            let team = new HotsDraftTeam(color);
            let playerPos = this.offsets["teams"][color]["players"];
            let detections = [];
            this.addTeam(team);
            // Bans
            detections.push( this.detectBans(team) );
            // Players
            for (let i = 0; i < playerPos.length; i++) {
                let player = new HotsDraftPlayer(i, team);
                detections.push( this.detectPlayer(player) );
            }
            Promise.all(detections).then((result) => {
                let banResult = result.shift();
                for (let i = 0; i < result.length; i++) {
                    team.addPlayer(result[i]);
                }
                resolve(true);
            });
        }).then((result) => {
            // Success
            this.emit("detect.team.success", color);
            this.emit("change");
            return result;
        });
    }
    detectBans(team) {
        return new Promise(async (resolve, reject) => {
            let teamOffsets = this.offsets["teams"][team.getColor()];
            // Get offsets
            let posBans = teamOffsets["bans"];
            let sizeBan = this.offsets["banSize"];
            // Check bans
            for (let i = 0; i < posBans.length; i++) {
                let posBan = posBans[i];
                let banImg = this.screenshot.clone().crop(posBan.x, posBan.y, sizeBan.x, sizeBan.y);
                if (HotsHelpers.imageBackgroundMatch(banImg, DraftLayout["colors"]["banBackground"])) {
                    // No ban yet
                    team.addBan(i, null);
                } else {
                    let banImgCompare = banImg.clone().resize(this.offsets["banSizeCompare"].x, this.offsets["banSizeCompare"].y);
                    if (this.generateDebugFiles) {
                        // Debug output
                        banImg.write("debug/" + team.color + "_ban" + i + "_Test.png");
                        banImgCompare.write("debug/" + team.color + "_ban" + i + "_TestCompare.png");
                    }
                    let matchBestHero = null;
                    let matchBestValue = 200;
                    for (let heroName in this.banImages) {
                        let heroValue = HotsHelpers.imageCompare(banImgCompare, this.banImages[heroName]);
                        if (heroValue > matchBestValue) {
                            matchBestHero = heroName;
                            matchBestValue = heroValue;
                        }
                    }
                    if (matchBestHero !== null) {
                        team.addBan(i, matchBestHero);
                    } else {
                        team.addBan(i, "???");
                        banImg.getBase64(jimp.MIME_PNG, (err, res) => {
                            team.addBanImageData(i, res);
                        });
                    }
                }
            }
            resolve(true);
        }).then((result) => {
            // Success
            this.emit("detect.bans.success", team);
            this.emit("change");
            return result;
        });
    }
    detectPlayer(player) {
        return new Promise(async (resolve, reject) => {
            let index = player.getIndex();
            let team = player.getTeam();
            let teamOffsets = this.offsets["teams"][team.getColor()];
            let colorIdent = team.getColor()+( this.teamActive == team.getColor() ? "-active" : "-inactive" );
            // Get offsets
            let posPlayer = teamOffsets["players"][index];
            let posName = teamOffsets["name"];
            let posHeroNameRot = teamOffsets["nameHeroRotated"];
            let posPlayerNameRot = teamOffsets["namePlayerRotated"];
            let sizePlayer = this.offsets["playerSize"];
            let sizeName = this.offsets["nameSize"];
            let sizeHeroNameRot = this.offsets["nameHeroSizeRotated"];
            let sizePlayerNameRot = this.offsets["namePlayerSizeRotated"];
            let detections = [];
            let playerImg = this.screenshot.clone().crop(posPlayer.x, posPlayer.y, sizePlayer.x, sizePlayer.y);
            if (this.generateDebugFiles) {
                // Debug output
                playerImg.write("debug/" + team.color + "_player" + index + "_Test.png");
            }
            let playerImgNameRaw = playerImg.clone().crop(posName.x, posName.y, sizeName.x, sizeName.y).scale(4, jimp.RESIZE_BILINEAR).rotate(posName.angle, jimp.RESIZE_BEZIER);
            if (this.generateDebugFiles) {
                // Debug output
                playerImgNameRaw.write("debug/" + team.color + "_player" + index + "_NameTest.png");
            }
            if (!player.isLocked()) {
                // Cleanup and trim hero name
                let heroImgName = playerImgNameRaw.clone().crop(posHeroNameRot.x, posHeroNameRot.y, sizeHeroNameRot.x, sizeHeroNameRot.y);
                let heroVisible = false;
                let heroLocked = false;
                if (HotsHelpers.imageBackgroundMatch(heroImgName, DraftLayout["colors"]["heroBackgroundLocked"][colorIdent])) {
                    // Hero locked!
                    if (HotsHelpers.imageCleanupName(heroImgName, DraftLayout["colors"]["heroNameLocked"][colorIdent], [], 0x000000FF, 0xFFFFFFFF)) {
                        heroImgName.greyscale().contrast(0.4).normalize().blur(1).scale(0.5, jimp.RESIZE_BILINEAR);
                        heroVisible = true;
                        heroLocked = true;
                    }
                } else {
                    player.setLocked(false);
                    if (team.getColor() === "blue") {
                        // Hero not locked!
                        let heroImgNameOrg = heroImgName.clone();
                        if ((colorIdent == "blue-active") && HotsHelpers.imageCleanupName(heroImgName, DraftLayout["colors"]["heroNamePrepick"][colorIdent+"-picking"])) {
                            heroImgName.greyscale().normalize().blur(1).scale(0.5, jimp.RESIZE_BILINEAR).invert();
                            heroVisible = true;
                        } else if (HotsHelpers.imageCleanupName(heroImgNameOrg, DraftLayout["colors"]["heroNamePrepick"][colorIdent])) {
                            heroImgName = heroImgNameOrg;
                            heroImgName.greyscale().normalize().blur(1).scale(0.5, jimp.RESIZE_BILINEAR).invert();
                            heroVisible = true;
                        }
                    }
                }
                if (this.generateDebugFiles) {
                    // Debug output
                    heroImgName.write("debug/" + team.color + "_player" + index + "_HeroNameTest.png");
                }
                if (heroVisible) {
                    // Detect hero name using tesseract
                    let imageHeroName = null;
                    detections.push(
                        heroImgName.getBufferAsync(jimp.MIME_PNG).then((buffer) => {
                            imageHeroName = buffer;
                            return worker.recognize(buffer, this.tessLangs, this.tessParams);
                        }).then((result) => {
                            let heroName = this.app.gameData.correctHeroName(result.text.trim());
                            if (heroName !== "PICKING") {
                                let detectionError = !this.app.gameData.heroExists(heroName);
                                player.setCharacter(heroName, detectionError);
                                player.setImageHeroName(imageHeroName);
                                player.setLocked(heroLocked);
                            }
                            return heroName;
                        })
                    )
                }
            }
            if (player.getName() === null) {
                // Cleanup and trim player name
                let playerImgName = playerImgNameRaw.clone().crop(posPlayerNameRot.x, posPlayerNameRot.y, sizePlayerNameRot.x, sizePlayerNameRot.y);
                if (!HotsHelpers.imageCleanupName(
                    playerImgName, DraftLayout["colors"]["playerName"][colorIdent], DraftLayout["colors"]["boost"]
                )) {
                    reject(new Error("Player name not found!"));
                }
                playerImgName.greyscale().contrast(0.4).normalize().blur(1).scale(0.5, jimp.RESIZE_BILINEAR).invert();
                if (this.generateDebugFiles) {
                    // Debug output
                    playerImgName.write("debug/" + team.color + "_player" + index + "_PlayerNameTest.png");
                }
                // Detect player name using tesseract
                let imagePlayerName = null;
                detections.push(
                    playerImgName.getBufferAsync(jimp.MIME_PNG).then((buffer) => {
                        imagePlayerName = buffer;
                        return worker.recognize(buffer, this.tessLangs, this.tessParams);
                    }).then((result) => {
                        let playerName = result.text.trim();
                        console.log(playerName);
                        player.setName(playerName);
                        player.setImagePlayerName(imagePlayerName);
                        return playerName;
                    })
                );
            }
            if (detections.length == 0) {
                resolve(player);
            } else {
                Promise.all(detections).then(() => {
                    resolve(player);
                }).catch((error) => {
                  reject(error);
              });
            }
        });
    }
    addTeam(team) {
        this.teams.push(team);
        team.on("change", () => {
            this.emit("team.updated", this);
            this.emit("change");
        });
    }
    /**
     * @returns {string|null}
     */
    getMap() {
        return this.map;
    }
    getTeam(color) {
        for (let i = 0; i < this.teams.length; i++) {
            if (this.teams[i].getColor() === color) {
                return this.teams[i];
            }
        }
        return null;
    }
    getTeamActive() {
        return this.teamActive;
    }
    getTeams() {
        return this.teams;
    }
    setMap(mapName) {
        console.log(mapName);
        this.map = mapName;
    }

}

module.exports = HotsDraftScreen;
