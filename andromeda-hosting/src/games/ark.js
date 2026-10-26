'use strict';
const fs = require('fs');
const path = require('path');
const Ini = require('../util/ini');
const Rcon = require('../util/rcon');
const steamcmd = require('../services/steamcmd');
const modinfo = require('../services/modinfo');
const { HttpError, randomPassword } = require('../util/misc');
const { splitArgs } = require('./minecraft');

const EDITIONS = {
  asa: {
    label: 'ARK: Survival Ascended',
    appId: 2430930,
    exe: { win32: 'ShooterGame/Binaries/Win64/ArkAscendedServer.exe' },
    maps: ['TheIsland_WP', 'ScorchedEarth_WP', 'TheCenter_WP', 'Aberration_WP', 'Extinction_WP', 'Ragnarok_WP', 'Valguero_WP', 'Astraeos_WP', 'LostColony_WP'],
  },
  ase: {
    label: 'ARK: Survival Evolved',
    appId: 376030,
    exe: { win32: 'ShooterGame/Binaries/Win64/ShooterGameServer.exe', linux: 'ShooterGame/Binaries/Linux/ShooterGameServer' },
    maps: ['TheIsland', 'TheCenter', 'ScorchedEarth_P', 'Ragnarok', 'Aberration_P', 'Extinction', 'Valguero_P', 'Genesis', 'Gen2', 'CrystalIsles', 'LostIsland', 'Fjordur'],
  },
};

// Settings stored on the server record and written into the INI files before every start,
// so ARK can't overwrite them when it saves its config on shutdown.
// `def` is ARK's own default: shown as the placeholder, and used for switches that were never set.
// A blank number/text field removes the line from the INI so ARK uses its default.
const GM = '/script/shootergame.shootergamemode';
const gus = (key, label, type, def, extra) => ({ key, file: 'gus', section: 'ServerSettings', label, type, def, ...extra });
const gm = (key, label, type, def, extra) => ({ key, file: 'game', section: GM, label, type, def, ...extra });
const inGroup = (group, fields) => fields.map((f) => ({ ...f, group }));

// Per-level stat multipliers: Game.ini keys like PerLevelStatsMultiplier_Player[7] (weight).
const STATS = [[0, 'Health'], [1, 'Stamina'], [3, 'Oxygen'], [4, 'Food'], [5, 'Water'], [7, 'Weight'], [8, 'Melee damage'], [9, 'Movement speed'], [10, 'Fortitude'], [11, 'Crafting skill']];
const DINO_STATS = [0, 1, 3, 4, 7, 8, 9];
const perLevel = (suffix, group, stats, def) =>
  STATS.filter(([i]) => stats.includes(i)).map(([i, name]) => ({ ...gm(`PerLevelStatsMultiplier_${suffix}[${i}]`, name, 'number', def, { step: 0.1 }), group }));

const FIELDS = [
  ...inGroup('General', [
    { key: 'SessionName', file: 'gus', section: 'SessionSettings', label: 'Server name (shown in server list)', type: 'text' },
    gus('ServerPassword', 'Join password (blank = public)', 'text'),
    gus('ServerAdminPassword', 'Admin password (also used by the panel for RCON)', 'text'),
    gus('SpectatorPassword', 'Spectator password', 'text'),
    { key: 'MessageOfTheDay', file: 'gus', section: 'MessageOfTheDay', iniKey: 'Message', label: 'Message of the day', type: 'text' },
    { key: 'MessageOfTheDayDuration', file: 'gus', section: 'MessageOfTheDay', iniKey: 'Duration', label: 'Message of the day duration (seconds)', type: 'number', def: 20 },
    gus('AdminLogging', 'Log admin commands to in-game chat', 'bool', false),
    gus('BanListURL', 'Ban list URL', 'text', undefined, { hint: 'Blank uses the official ban list' }),
  ]),
  ...inGroup('Rules', [
    gus('ServerPVE', 'PvE mode', 'bool', false),
    gus('ServerHardcore', 'Hardcore (respawn as a new level 1 character)', 'bool', false),
    gus('AllowThirdPersonPlayer', 'Allow third person', 'bool'),
    gus('ServerCrosshair', 'Crosshair', 'bool'),
    gus('ShowMapPlayerLocation', 'Show player on map', 'bool'),
    gus('ServerForceNoHUD', 'Force HUD off', 'bool', false),
    gus('AllowHitMarkers', 'Hit markers', 'bool', true),
    gus('ShowFloatingDamageText', 'Floating damage numbers', 'bool', false),
    gus('DisableWeatherFog', 'Disable fog', 'bool', false),
    gus('AllowFlyerCarryPvE', 'Flyers can carry in PvE', 'bool', false),
    gus('AllowFlyingStaminaRecovery', 'Flyers recover stamina while flying', 'bool', false),
    gus('AlwaysAllowStructurePickup', 'Always allow structure pickup', 'bool', false),
    gus('AllowCaveBuildingPvE', 'Allow building in caves (PvE)', 'bool', false),
    gus('AllowCaveBuildingPvP', 'Allow building in caves (PvP)', 'bool', true),
    gus('PreventDiseases', 'Disable diseases', 'bool', false),
    gus('NonPermanentDiseases', 'Diseases cured on respawn', 'bool', false),
    gus('PreventSpawnAnimations', 'Skip the wake-up animation on spawn', 'bool', false),
    gus('RandomSupplyCratePoints', 'Random supply drop locations', 'bool', false),
    gus('PvEAllowStructuresAtSupplyDrops', 'Allow building near supply drops (PvE)', 'bool', false),
    gus('ClampResourceHarvestDamage', 'Clamp harvest damage (official behaviour)', 'bool', false),
    gm('bAllowUnlimitedRespecs', 'Unlimited mindwipes', 'bool', false),
    gm('bAutoUnlockAllEngrams', 'Unlock all engrams', 'bool', false),
    gm('bAllowCustomRecipes', 'Allow custom recipes', 'bool', true),
    gm('bUseCorpseLocator', 'Show corpse location beam', 'bool', true),
    gm('bShowCreativeMode', 'Creative mode (admin cheat menu for all)', 'bool', false),
    gm('bUseSingleplayerSettings', 'Use single-player balance settings', 'bool', false),
    gm('bDisableLootCrates', 'Disable loot crates', 'bool', false),
    gm('bDisablePhotoMode', 'Disable photo mode', 'bool', false, { editions: ['asa'] }),
  ]),
  ...inGroup('PvP', [
    gus('PreventOfflinePvP', 'Offline raid protection (ORP)', 'bool', false),
    gus('PreventOfflinePvPInterval', 'ORP kicks in after (seconds offline)', 'number', 0),
    gm('bDisableFriendlyFire', 'Disable friendly fire (PvP)', 'bool', false),
    gm('bPvEDisableFriendlyFire', 'Disable friendly fire (PvE)', 'bool', false),
    gus('EnablePvPGamma', 'Allow gamma changes (PvP)', 'bool', false),
    gus('DisablePvEGamma', 'Block gamma changes (PvE)', 'bool', false),
    gm('bIncreasePvPRespawnInterval', 'Longer respawn timer after repeated PvP deaths', 'bool', true),
    gm('bPassiveDefensesDamageRiderlessDinos', 'Spikes/turrets hurt riderless dinos', 'bool', false),
    gus('AllowMultipleAttachedC4', 'Allow multiple C4 on one dino', 'bool', false),
    gm('bAutoPvETimer', 'Scheduled PvE (switch to PvE at set times)', 'bool', false),
    gm('bAutoPvEUseSystemTime', 'Scheduled PvE uses real clock (not in-game time)', 'bool', false),
    gm('AutoPvEStartTimeSeconds', 'Scheduled PvE starts at (seconds into the day)', 'number', 0),
    gm('AutoPvEStopTimeSeconds', 'Scheduled PvE stops at (seconds into the day)', 'number', 0),
  ]),
  ...inGroup('Rates', [
    gus('DifficultyOffset', 'Difficulty offset (0–1)', 'number', undefined, { step: 0.1 }),
    gus('OverrideOfficialDifficulty', 'Override difficulty (5 = max wild level 150)', 'number', undefined, { step: 0.5 }),
    gus('XPMultiplier', 'XP multiplier', 'number', 1, { step: 0.5 }),
    gus('TamingSpeedMultiplier', 'Taming speed', 'number', 1, { step: 0.5 }),
    gus('HarvestAmountMultiplier', 'Harvest amount', 'number', 1, { step: 0.5 }),
    gus('HarvestHealthMultiplier', 'Harvest health (resource node durability)', 'number', 1, { step: 0.1 }),
    gus('ItemStackSizeMultiplier', 'Stack size multiplier', 'number', 1, { step: 1 }),
    gus('ResourcesRespawnPeriodMultiplier', 'Resource respawn period (lower = faster)', 'number', 1, { step: 0.1 }),
    gus('DinoCountMultiplier', 'Wild dino count', 'number', 1, { step: 0.1 }),
    gus('PlayerDamageMultiplier', 'Player damage', 'number', 1, { step: 0.1 }),
    gus('PlayerResistanceMultiplier', 'Player resistance (lower = tougher)', 'number', 1, { step: 0.1 }),
    gus('DinoDamageMultiplier', 'Dino damage', 'number', 1, { step: 0.1 }),
    gus('DinoResistanceMultiplier', 'Dino resistance (lower = tougher)', 'number', 1, { step: 0.1 }),
    gus('StructureDamageMultiplier', 'Structure damage', 'number', 1, { step: 0.1 }),
    gus('StructureResistanceMultiplier', 'Structure resistance (lower = tougher)', 'number', 1, { step: 0.1 }),
    gm('DinoHarvestingDamageMultiplier', 'Dino harvesting damage', 'number', 3.2, { step: 0.1 }),
    gm('PlayerHarvestingDamageMultiplier', 'Player harvesting damage', 'number', 1, { step: 0.1 }),
    gm('CraftingSkillBonusMultiplier', 'Crafting skill bonus', 'number', 1, { step: 0.1 }),
    gm('CustomRecipeEffectivenessMultiplier', 'Custom recipe effectiveness', 'number', 1, { step: 0.1 }),
    gm('SupplyCrateLootQualityMultiplier', 'Supply crate loot quality', 'number', 1, { step: 0.1 }),
    gm('FishingLootQualityMultiplier', 'Fishing loot quality', 'number', 1, { step: 0.1 }),
  ]),
  ...inGroup('XP', [
    gm('KillXPMultiplier', 'Kill XP', 'number', 1, { step: 0.5 }),
    gm('HarvestXPMultiplier', 'Harvest XP', 'number', 1, { step: 0.5 }),
    gm('CraftXPMultiplier', 'Craft XP', 'number', 1, { step: 0.5 }),
    gm('GenericXPMultiplier', 'Generic XP (passive)', 'number', 1, { step: 0.5 }),
    gm('SpecialXPMultiplier', 'Special XP', 'number', 1, { step: 0.5 }),
    gm('ExplorerNoteXPMultiplier', 'Explorer note XP', 'number', 1, { step: 0.5 }),
    gm('BossKillXPMultiplier', 'Boss kill XP', 'number', 1, { step: 0.5 }),
    gm('AlphaKillXPMultiplier', 'Alpha kill XP', 'number', 1, { step: 0.5 }),
    gm('WildKillXPMultiplier', 'Wild kill XP', 'number', 1, { step: 0.5 }),
    gm('CaveKillXPMultiplier', 'Cave kill XP', 'number', 1, { step: 0.5 }),
    gm('TamedKillXPMultiplier', 'Tamed kill XP', 'number', 1, { step: 0.5 }),
    gm('UnclaimedKillXPMultiplier', 'Unclaimed kill XP', 'number', 1, { step: 0.5 }),
    gm('OverrideMaxExperiencePointsPlayer', 'Max player XP (raise with a level ramp override)', 'number'),
    gm('OverrideMaxExperiencePointsDino', 'Max dino XP', 'number'),
  ]),
  ...inGroup('Survival', [
    gus('PlayerCharacterFoodDrainMultiplier', 'Player food drain', 'number', 1, { step: 0.1 }),
    gus('PlayerCharacterWaterDrainMultiplier', 'Player water drain', 'number', 1, { step: 0.1 }),
    gus('PlayerCharacterStaminaDrainMultiplier', 'Player stamina drain', 'number', 1, { step: 0.1 }),
    gus('PlayerCharacterHealthRecoveryMultiplier', 'Player health recovery', 'number', 1, { step: 0.1 }),
    gus('OxygenSwimSpeedStatMultiplier', 'Oxygen stat → swim speed', 'number', 1, { step: 0.1 }),
    gus('DinoCharacterFoodDrainMultiplier', 'Dino food drain', 'number', 1, { step: 0.1 }),
    gus('DinoCharacterStaminaDrainMultiplier', 'Dino stamina drain', 'number', 1, { step: 0.1 }),
    gus('DinoCharacterHealthRecoveryMultiplier', 'Dino health recovery', 'number', 1, { step: 0.1 }),
    gm('GlobalSpoilingTimeMultiplier', 'Food spoil time (higher = slower)', 'number', 1, { step: 0.1 }),
    gm('GlobalItemDecompositionTimeMultiplier', 'Dropped item lifetime', 'number', 1, { step: 0.1 }),
    gm('GlobalCorpseDecompositionTimeMultiplier', 'Corpse lifetime', 'number', 1, { step: 0.1 }),
    gm('FuelConsumptionIntervalMultiplier', 'Fuel burn interval (higher = lasts longer)', 'number', 1, { step: 0.1 }),
    gm('CropGrowthSpeedMultiplier', 'Crop growth speed', 'number', 1, { step: 0.1 }),
    gm('CropDecaySpeedMultiplier', 'Crop decay speed', 'number', 1, { step: 0.1 }),
    gm('PoopIntervalMultiplier', 'Poop interval', 'number', 1, { step: 0.1 }),
    gm('HairGrowthSpeedMultiplier', 'Hair growth speed', 'number', 1, { step: 0.1 }),
    gus('ResourceNoReplenishRadiusPlayers', 'No-regrowth radius around players', 'number', 1, { step: 0.1 }),
    gus('ResourceNoReplenishRadiusStructures', 'No-regrowth radius around structures', 'number', 1, { step: 0.1 }),
  ]),
  ...inGroup('Day & night', [
    gus('DayCycleSpeedScale', 'Day cycle speed', 'number', 1, { step: 0.1 }),
    gus('DayTimeSpeedScale', 'Daytime speed', 'number', 1, { step: 0.1 }),
    gus('NightTimeSpeedScale', 'Night speed', 'number', 1, { step: 0.1 }),
  ]),
  ...inGroup('Dinos', [
    gm('WildDinoCharacterFoodDrainMultiplier', 'Wild dino food drain', 'number', 1, { step: 0.1 }),
    gm('WildDinoTorporDrainMultiplier', 'Wild dino torpor drain (lower = stays knocked out longer)', 'number', 1, { step: 0.1 }),
    gm('TamedDinoCharacterFoodDrainMultiplier', 'Tamed dino food drain', 'number', 1, { step: 0.1 }),
    gm('TamedDinoTorporDrainMultiplier', 'Tamed dino torpor drain', 'number', 1, { step: 0.1 }),
    gm('PassiveTameIntervalMultiplier', 'Passive tame feeding interval', 'number', 1, { step: 0.1 }),
    gus('AllowRaidDinoFeeding', 'Titanosaurs can be fed (permanent tame)', 'bool', false),
    gus('RaidDinoCharacterFoodDrainMultiplier', 'Raid dino food drain', 'number', 1, { step: 0.1 }),
    gm('bAllowSpeedLeveling', 'Allow movement speed leveling', 'bool', false),
    gm('bAllowFlyerSpeedLeveling', 'Allow flyer speed leveling', 'bool', false),
    gm('bAllowUnclaimDinos', 'Allow unclaiming dinos', 'bool', true),
    gm('bDisableDinoRiding', 'Disable dino riding', 'bool', false),
    gm('bDisableDinoTaming', 'Disable dino taming', 'bool', false),
    gus('DisableDinoDecayPvE', 'Disable dino decay (PvE)', 'bool', false),
    gus('PvEDinoDecayPeriodMultiplier', 'Dino decay period (PvE)', 'number', 1, { step: 0.1 }),
    gus('PvPDinoDecay', 'Dino decay (PvP)', 'bool', false),
    gus('AutoDestroyDecayedDinos', 'Delete decayed dinos', 'bool', false),
    gus('AllowCryoFridgeOnSaddle', 'Cryofridge on saddles', 'bool', false),
    gus('DisableCryopodEnemyCheck', 'Cryopods work near enemies', 'bool', false),
    gus('DisableCryopodFridgeRequirement', 'Cryopods work without a cryofridge', 'bool', false),
    gus('ServerAutoForceRespawnWildDinosInterval', 'Wipe wild dinos every (seconds, 0 = never)', 'number', 0),
  ]),
  ...inGroup('Breeding', [
    gm('MatingIntervalMultiplier', 'Mating interval (lower = faster)', 'number', 1, { step: 0.1 }),
    gm('MatingSpeedMultiplier', 'Mating speed', 'number', 1, { step: 0.1 }),
    gm('LayEggIntervalMultiplier', 'Egg laying interval', 'number', 1, { step: 0.1 }),
    gm('EggHatchSpeedMultiplier', 'Egg hatch speed', 'number', 1, { step: 1 }),
    gm('BabyMatureSpeedMultiplier', 'Baby mature speed', 'number', 1, { step: 1 }),
    gm('BabyFoodConsumptionSpeedMultiplier', 'Baby food consumption', 'number', 1, { step: 0.1 }),
    gm('BabyCuddleIntervalMultiplier', 'Imprint interval (lower = more often)', 'number', 1, { step: 0.1 }),
    gm('BabyCuddleGracePeriodMultiplier', 'Imprint grace period', 'number', 1, { step: 0.1 }),
    gm('BabyCuddleLoseImprintQualitySpeedMultiplier', 'Imprint loss speed when missed', 'number', 1, { step: 0.1 }),
    gm('BabyImprintAmountMultiplier', 'Imprint amount per cuddle', 'number', 1, { step: 0.1 }),
    gm('BabyImprintingStatScaleMultiplier', 'Imprint stat bonus', 'number', 1, { step: 0.1 }),
    gus('AllowAnyoneBabyImprintCuddle', 'Anyone can imprint (not just the claimer)', 'bool', false),
    gus('DisableImprintDinoBuff', 'Disable imprint rider buff', 'bool', false),
    gus('PreventMateBoost', 'Disable mate boost', 'bool', false),
    gm('bDisableDinoBreeding', 'Disable breeding', 'bool', false),
  ]),
  ...inGroup('Structures', [
    gus('DisableStructureDecayPvE', 'Disable structure decay (PvE)', 'bool', false),
    gus('PvEStructureDecayPeriodMultiplier', 'Structure decay period (PvE)', 'number', 1, { step: 0.1 }),
    gus('PvPStructureDecay', 'Structure decay (PvP)', 'bool', false),
    gus('AutoDestroyOldStructuresMultiplier', 'Auto-destroy abandoned structures (0 = off)', 'number', 0, { step: 0.1 }),
    gus('OnlyAutoDestroyCoreStructures', 'Auto-destroy only core structures', 'bool', false),
    gus('OnlyDecayUnsnappedCoreStructures', 'Decay only unsnapped core structures', 'bool', false),
    gus('FastDecayUnsnappedCoreStructures', 'Unsnapped core structures decay fast', 'bool', false),
    gus('DestroyUnconnectedWaterPipes', 'Destroy unconnected water pipes', 'bool', false),
    gus('TheMaxStructuresInRange', 'Max structures in range', 'number', 10500),
    gus('PerPlatformMaxStructuresMultiplier', 'Platform saddle structure limit multiplier', 'number', 1, { step: 0.1 }),
    gus('MaxPlatformSaddleStructureLimit', 'Max platform saddles', 'number'),
    gus('MaxGateFrameOnSaddles', 'Max gateways on platform saddles', 'number', 0),
    gm('bAllowPlatformSaddleMultiFloors', 'Multi-floor platform saddles', 'bool', false),
    gm('bFlyerPlatformAllowUnalignedDinoBasing', 'Dinos can stand on flyer platforms', 'bool', false),
    gus('OverrideStructurePlatformPrevention', 'Allow turrets/spikes on platforms', 'bool', false),
    gus('EnableExtraStructurePreventionVolumes', 'Extra no-build zones (official)', 'bool', false),
    gm('bDisableStructurePlacementCollision', 'Disable structure placement collision', 'bool', false),
    gus('StructurePickupTimeAfterPlacement', 'Pickup window after placing (seconds)', 'number', 30),
    gus('StructurePickupHoldDuration', 'Pickup hold time (seconds)', 'number', 0.5, { step: 0.1 }),
    gus('StructurePreventResourceRadiusMultiplier', 'Structure no-regrowth radius', 'number', 1, { step: 0.1 }),
    gm('StructureDamageRepairCooldown', 'Repair cooldown after damage (seconds)', 'number', 180),
    gus('ForceAllStructureLocking', 'Lock all structures by default', 'bool', false),
    gm('bLimitTurretsInRange', 'Limit turrets in range', 'bool', true),
    gm('LimitTurretsNum', 'Max turrets in range', 'number', 100),
    gm('LimitTurretsRange', 'Turret limit range (units)', 'number', 10000),
    gm('bHardLimitTurretsInRange', 'Hard turret limit (disable extras)', 'bool', false),
  ]),
  ...inGroup('Tribes', [
    gm('MaxNumberOfPlayersInTribe', 'Max players per tribe (0 = unlimited)', 'number', 0),
    gus('TribeNameChangeCooldown', 'Tribe rename cooldown (minutes)', 'number', 15),
    gus('PreventTribeAlliances', 'Disable alliances', 'bool', false),
    gm('MaxAlliancesPerTribe', 'Max alliances per tribe', 'number'),
    gm('MaxTribesPerAlliance', 'Max tribes per alliance', 'number'),
    gm('bPvEAllowTribeWar', 'Allow tribe wars (PvE)', 'bool', true),
    gm('bPvEAllowTribeWarCancel', 'Allow cancelling tribe wars (PvE)', 'bool', false),
    gus('TribeLogDestroyedEnemyStructures', 'Log destroyed enemy structures', 'bool', false),
  ]),
  ...inGroup('Limits', [
    gus('MaxTamedDinos', 'Max tamed dinos', 'number', 5000),
    gus('MaxPersonalTamedDinos', 'Max tamed dinos per tribe (0 = unlimited)', 'number', 0),
    gus('MaxTamedDinos_SoftTameLimit', 'Soft tame limit per tribe', 'number', 5000, { editions: ['asa'] }),
    gus('MaxTamedDinos_SoftTameLimit_CountdownForDeletionDuration', 'Soft tame limit grace period (seconds)', 'number', 604800, { editions: ['asa'] }),
    gus('DestroyTamesOverTheSoftTameLimit', 'Delete tames over the soft limit', 'bool', false, { editions: ['asa'] }),
    gus('AutoSavePeriodMinutes', 'Autosave every (minutes)', 'number', 15),
    gus('KickIdlePlayersPeriod', 'Kick idle players after (seconds)', 'number', 3600, { hint: 'Needs "Kick idle players" under Launch options' }),
  ]),
  ...inGroup('Cluster & transfers', [
    gus('NoTributeDownloads', 'Block all downloads from other servers', 'bool', false),
    gus('PreventDownloadSurvivors', 'Block survivor downloads', 'bool', false),
    gus('PreventDownloadItems', 'Block item downloads', 'bool', false),
    gus('PreventDownloadDinos', 'Block dino downloads', 'bool', false),
    gus('PreventUploadSurvivors', 'Block survivor uploads', 'bool', false),
    gus('PreventUploadItems', 'Block item uploads', 'bool', false),
    gus('PreventUploadDinos', 'Block dino uploads', 'bool', false),
    gus('CrossARKAllowForeignDinoDownloads', 'Allow non-native dinos to transfer in', 'bool', false),
    gus('MaxTributeDinos', 'Max uploaded dinos', 'number', 20),
    gus('MaxTributeItems', 'Max uploaded items', 'number', 50),
    gus('MinimumDinoReuploadInterval', 'Dino re-upload cooldown (seconds)', 'number', 0),
    gus('TributeItemExpirationSeconds', 'Uploaded items expire after (seconds)', 'number', 86400),
    gus('TributeDinoExpirationSeconds', 'Uploaded dinos expire after (seconds)', 'number', 86400),
    gus('TributeCharacterExpirationSeconds', 'Uploaded survivors expire after (seconds, 0 = never)', 'number', 0),
  ]),
  ...inGroup('Chat & logs', [
    gus('globalVoiceChat', 'Global voice chat', 'bool', false),
    gus('proximityChat', 'Proximity text chat', 'bool', false),
    gus('alwaysNotifyPlayerLeft', 'Announce players leaving', 'bool', false),
    gus('DontAlwaysNotifyPlayerJoined', 'Hide player join messages', 'bool', false),
    gus('AllowHideDamageSourceFromLogs', 'Hide damage source in tribe logs', 'bool', true),
  ]),
  ...perLevel('Player', 'Per-level stats: players', [0, 1, 3, 4, 5, 7, 8, 9, 10, 11], 1),
  ...perLevel('DinoWild', 'Per-level stats: wild dinos', DINO_STATS, 1),
  ...perLevel('DinoTamed', 'Per-level stats: tamed dinos', DINO_STATS),
  ...perLevel('DinoTamed_Add', 'Per-level stats: tamed dinos (taming bonus add)', DINO_STATS),
  ...perLevel('DinoTamed_Affinity', 'Per-level stats: tamed dinos (taming effectiveness)', DINO_STATS),
];

// Section order and which ones start collapsed in the panel.
const GROUPS = ['Launch', 'Launch options', 'General', 'Rules', 'PvP', 'Rates', 'XP', 'Engram points', 'Survival', 'Day & night', 'Dinos', 'Breeding', 'Structures', 'Tribes', 'Limits', 'Cluster & transfers', 'Chat & logs'];
const OPEN_GROUPS = new Set(['Launch', 'General', 'Rules', 'Rates']);

const EVENTS = ['Easter', 'Summer', 'FearEvolved', 'TurkeyTrial', 'WinterWonderland', 'vday', 'birthday', 'Arkaeology', 'ExtinctionChronicles', 'PAX'];

// Stored on server.ark. `flag` = command-line switch added when the box is ticked.
// Only fixed switches and pattern-checked values are open to "settings" friends; free text is admin only.
const LAUNCH_FIELDS = [
  { name: 'map', label: 'Map', type: 'select-custom' },
  { name: 'maxPlayers', label: 'Max players', type: 'number' },
  { name: 'port', label: 'Game port (UDP)', type: 'number' },
  { name: 'queryPort', label: 'Query port (UDP, ARK: SE only)', type: 'number' },
  { name: 'rconPort', label: 'RCON port (TCP, local only)', type: 'number' },
  { name: 'battleye', label: 'BattlEye anti-cheat', type: 'bool' },
  { name: 'pcOnly', label: 'PC players only (disable crossplay)', type: 'bool', editions: ['asa'] },
  { name: 'clusterId', label: 'Cluster ID (servers with the same ID allow transfers)', type: 'text' },
  { name: 'showConsole', label: 'Open ARK console window (-log)', type: 'bool' },
  { name: 'activeEvent', label: 'Active event', type: 'select-custom', options: EVENTS, pattern: /^\w*$/, hint: 'Seasonal event to run (-ActiveEvent). Blank = none.' },
  { name: 'passiveMods', label: 'Passive mods (IDs, comma-separated)', type: 'text', pattern: /^[\d,\s]*$/, editions: ['asa'], hint: 'Loaded for their content (e.g. a map\'s dependencies) without being active' },
  { name: 'altSaveDir', label: 'Save folder name', type: 'text', pattern: /^[\w-]*$/, hint: 'AltSaveDirectoryName — use a different name to keep a separate world on the same map' },
  { name: 'culture', label: 'Server language', type: 'text', pattern: /^([a-z]{2}(-[A-Za-z]{2})?)?$/, hint: 'e.g. en, de, fr, pt-BR (-culture)' },
  { name: 'extraArgs', label: 'Extra command-line arguments', type: 'text', admin: true, hint: 'Admin only — e.g. -NoBiomeWalls' },
  ...[
    ['forceAllowCaveFlyers', '-ForceAllowCaveFlyers', 'Allow flyers in caves'],
    ['noTransferFromFiltering', '-NoTransferFromFiltering', 'Allow transfers from any cluster/server'],
    ['forceRespawnDinos', '-ForceRespawnDinos', 'Wipe wild dinos on every start'],
    ['enableIdlePlayerKick', '-EnableIdlePlayerKick', 'Kick idle players'],
    ['exclusiveJoin', '-exclusivejoin', 'Whitelist only (PlayersExclusiveJoinList.txt)'],
    ['useDynamicConfig', '-UseDynamicConfig', 'Use dynamic config (official live tuning)'],
    ['structureStasisGrid', '-UseStructureStasisGrid', 'Structure stasis grid (better performance with big bases)'],
    ['stasisKeepControllers', '-StasisKeepControllers', 'Keep AI controllers in stasis (less CPU spike when loading)'],
    ['noUndermeshChecking', '-noundermeshchecking', 'Disable under-mesh checking'],
    ['noUndermeshKilling', '-noundermeshkilling', 'Don\'t kill players found under the map'],
    ['autoDestroyStructures', '-AutoDestroyStructures', 'Run abandoned structure auto-destroy'],
    ['noHangDetection', '-NoHangDetection', 'Disable hang detection (helps slow mod loading)'],
    ['tribeLogs', '-servergamelogincludetribelogs', 'Include tribe logs in the server log'],
    ['allowAnsel', '-ServerAllowAnsel', 'Allow NVIDIA Ansel'],
  ].map(([name, flag, label]) => ({ name, flag, label, type: 'bool', group: 'Launch options' })),
].map((f) => ({ group: 'Launch', ...f, key: 'launch.' + f.name }));

function edition(server) {
  return EDITIONS[server.ark.edition] || EDITIONS.asa;
}
function configDir(server) {
  const platformDir = process.platform === 'win32' ? 'WindowsServer' : 'LinuxServer';
  return path.join(server.dir, 'ShooterGame', 'Saved', 'Config', platformDir);
}
function iniPath(server, which) {
  return path.join(configDir(server), which === 'game' ? 'Game.ini' : 'GameUserSettings.ini');
}
// Unreal saves an INI as UTF-16 (with a BOM) once it holds any non-ASCII character, e.g. an
// accented server name or an emoji in the message of the day. Read both, and write the same way.
function loadIni(server, which) {
  const p = iniPath(server, which);
  const buf = fs.existsSync(p) ? fs.readFileSync(p) : Buffer.alloc(0);
  const utf16 = buf[0] === 0xff && buf[1] === 0xfe;
  const ini = new Ini(utf16 ? buf.toString('utf16le', 2) : buf.toString('utf8'));
  ini.utf16 = utf16;
  return ini;
}
function saveIni(server, which, ini) {
  const text = ini.toString();
  const utf16 = ini.utf16 || /[^\x00-\x7f]/.test(text);
  fs.writeFileSync(iniPath(server, which), utf16 ? Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')]) : text);
}
function sameValue(field, x, y) {
  if (x == null || y == null) return x == y;
  if (field.type === 'number') return Number(x) === Number(y); // ARK rewrites 2 as 2.000000
  return String(x).trim().toLowerCase() === String(y).trim().toLowerCase();
}
function parseIniValue(field, v) {
  if (field.type === 'bool') return String(v).trim().toLowerCase() === 'true';
  if (field.type === 'number') return Number.isFinite(Number(v)) ? Number(v) : undefined;
  return String(v);
}
// A value in the file that differs from what the panel last wrote there was edited by hand
// (Files tab, Notepad), so it wins over the panel's copy. Returns undefined when nothing changed.
// ARK rewrites the files on shutdown with the values it started with, which still match.
function editedInFile(server, files, f) {
  const a = server.ark;
  const inFile = files[f.file].get(f.section, f.iniKey || f.key);
  if (inFile === undefined) return undefined;
  const stored = a.settings[f.key];
  const last = a.iniWritten ? a.iniWritten[f.key] : stored === undefined ? undefined : iniValue(f, stored);
  if (last === undefined || sameValue(f, inFile, last)) return undefined;
  return parseIniValue(f, inFile);
}
function iniValue(field, v) {
  if (v === null || v === undefined) return null; // cleared: remove the line so ARK uses its default
  if (field.type === 'bool') return v ? 'True' : 'False';
  return v;
}

// "Extra INI lines" boxes, for settings ARK repeats per line (engram/item/spawn overrides).
// Key=Value lines go into the file's main section; a [Section] line switches section.
// Engram points per level: Game.ini repeats OverridePlayerLevelEngramPoints once per level, in
// order (line 1 = level 1). The panel builds those lines from one value for every level plus
// optional level ranges, so nobody has to type 105+ lines.
const ENGRAM_KEY = 'OverridePlayerLevelEngramPoints';
const ENGRAM_LEVELS = 105; // ARK's normal player level cap
const ENGRAM_MAX_LEVELS = 5000;
const ENGRAM_MODES = ['default', 'same', 'custom'];

function parseEngramRanges(text) {
  const ranges = [];
  String(text || '').split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim();
    if (!line) return;
    const m = /^(\d+)\s*(?:-\s*(\d+))?\s*[=:]\s*(\d+)$/.exec(line);
    if (!m) throw new HttpError(400, `Engram points, line ${i + 1}: write it like 1-10 = 8 or 25 = 12`);
    const from = Number(m[1]);
    const to = m[2] ? Number(m[2]) : from;
    if (from < 1 || to < from || to > ENGRAM_MAX_LEVELS) throw new HttpError(400, `Engram points, line ${i + 1}: levels must go from low to high, between 1 and ${ENGRAM_MAX_LEVELS}`);
    ranges.push({ from, to, points: Number(m[3]) });
  });
  return ranges;
}

// The points for each level (index 0 = level 1), or null for ARK's own table.
function engramList(e) {
  if (!e || e.mode === 'default' || !ENGRAM_MODES.includes(e.mode)) return null;
  const ranges = e.mode === 'custom' ? parseEngramRanges(e.custom) : [];
  const levels = e.levels || Math.max(ENGRAM_LEVELS, ...ranges.map((r) => r.to));
  const list = new Array(levels).fill(e.points || 0);
  for (const r of ranges) for (let l = r.from; l <= Math.min(r.to, levels); l++) list[l - 1] = r.points;
  return list;
}

// The other way round, for lines found in Game.ini: one value, or ranges of equal values.
function engramsFromList(list) {
  if (list.every((n) => n === list[0])) return { mode: 'same', levels: list.length, points: list[0], custom: '' };
  const lines = [];
  for (let i = 0; i < list.length; ) {
    let j = i;
    while (j + 1 < list.length && list[j + 1] === list[i]) j++;
    lines.push(`${i === j ? i + 1 : `${i + 1}-${j + 1}`} = ${list[i]}`);
    i = j + 1;
  }
  return { mode: 'custom', levels: list.length, points: null, custom: lines.join('\n') };
}

// The panel's engram settings, unless the lines in Game.ini were edited by hand since the panel
// last wrote them (same rule as the other settings): then the file wins.
function engramState(server, game) {
  const a = server.ark;
  const inFile = game.getAll(GM, ENGRAM_KEY).map((v) => Number(String(v).trim()));
  const written = (a.engramsWritten || []).map(Number);
  const edited = inFile.length && (inFile.length !== written.length || inFile.some((n, i) => n !== written[i]));
  if (edited && inFile.every((n) => Number.isInteger(n) && n >= 0)) return engramsFromList(inFile);
  return a.engrams || { mode: 'default', levels: null, points: null, custom: '' };
}

function engramSummary(e) {
  let list;
  try {
    list = engramList(e);
  } catch {
    return '';
  }
  if (!list) return 'Currently using ARK\'s own engram points.';
  return `Currently: ${list.length} levels, ${list.reduce((n, x) => n + x, 0)} engram points in total.`;
}

const EXTRA = {
  gus: { file: 'GameUserSettings.ini', section: 'ServerSettings' },
  game: { file: 'Game.ini', section: GM },
};
// The panel needs these for RCON (console, player list, graceful shutdown) and the port check.
const PANEL_KEYS = new Set(['rconenabled', 'rconport', 'port', 'queryport', 'serveradminpassword']);
function parseExtra(which, text) {
  let section = EXTRA[which].section;
  const lines = [];
  String(text || '').split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim();
    if (!line || line.startsWith(';') || line.startsWith('#')) return;
    const sec = /^\[([^\]]+)\]$/.exec(line);
    if (sec) {
      section = sec[1].trim();
      return;
    }
    const eq = line.indexOf('=');
    const key = eq > 0 ? line.slice(0, eq).trim() : '';
    const where = `Extra ${EXTRA[which].file} lines, line ${i + 1}`;
    if (!/^[\w.[\]]+$/.test(key)) throw new HttpError(400, `${where}: expected Key=Value`);
    if (PANEL_KEYS.has(key.toLowerCase())) throw new HttpError(400, `${where}: ${key} is set by the panel`);
    lines.push({ section, key, value: line.slice(eq + 1) });
  });
  return lines;
}

const rconClients = new Map();
async function rcon(server, command) {
  const key = server.id;
  let client = rconClients.get(key);
  if (!client || client.port !== server.ark.rconPort || client.password !== server.ark.settings.ServerAdminPassword) {
    if (client) client.close();
    client = new Rcon('127.0.0.1', server.ark.rconPort, server.ark.settings.ServerAdminPassword, { timeout: 6000 });
    rconClients.set(key, client);
  }
  try {
    return await client.send(command);
  } catch (err) {
    client.close();
    throw err;
  }
}

const ark = {
  id: 'ark',
  name: 'ARK',
  consoleMode: 'rcon',
  stopTimeoutMs: 180000,
  EDITIONS,

  defaults(input) {
    const a = input.ark || {};
    const ed = EDITIONS[a.edition] ? a.edition : 'asa';
    const out = {
      edition: ed,
      map: a.map || EDITIONS[ed].maps[0],
      maxPlayers: Number(a.maxPlayers) || 20,
      port: Number(a.port) || 7777,
      queryPort: Number(a.queryPort) || 27015,
      rconPort: Number(a.rconPort) || 27020,
      battleye: false,
      pcOnly: false,
      clusterId: '',
      showConsole: false,
      extraArgs: '',
      mods: (Array.isArray(a.mods) ? a.mods : String(a.mods || '').split(','))
        .map((s) => String(s).trim())
        .filter((s) => /^\d+$/.test(s)),
      settings: {
        SessionName: a.sessionName || input.name,
        ServerPassword: a.serverPassword || '',
        ServerAdminPassword: a.adminPassword || randomPassword(14),
      },
      extraIni: { gus: '', game: '' },
    };
    for (const f of LAUNCH_FIELDS) if (!(f.name in out)) out[f.name] = f.type === 'bool' ? false : '';
    return out;
  },

  ports(server) {
    const a = server.ark;
    const ports = [
      { port: a.port, proto: 'UDP', label: 'Game', forward: true },
      { port: a.port + 1, proto: 'UDP', label: 'Game (raw)', forward: a.edition === 'ase' },
      { port: a.rconPort, proto: 'TCP', label: 'RCON (keep closed)', forward: false },
    ];
    if (a.edition === 'ase') ports.splice(2, 0, { port: a.queryPort, proto: 'UDP', label: 'Steam query', forward: true });
    return ports.filter((p) => p.forward || p.label.startsWith('RCON'));
  },

  connectAddress(server, host) {
    return `${host}:${server.ark.port}`;
  },

  exePath(server) {
    const rel = edition(server).exe[process.platform];
    return rel ? path.join(server.dir, rel) : null;
  },

  async install(server, log, opts = {}) {
    const ed = edition(server);
    if (!ed.exe[process.platform]) {
      throw new Error(`${ed.label} dedicated server only runs on Windows. Run Andromeda Hosting on your Windows PC to host it.`);
    }
    log.info(`${opts.isUpdate ? 'Updating' : 'Installing'} ${ed.label} dedicated server via SteamCMD (app ${ed.appId}).`);
    if (!opts.isUpdate) log.info('First install downloads roughly 10–15 GB, so this can take a while.');
    await steamcmd.appUpdate(ed.appId, server.dir, { validate: !!opts.validate, log });
    this.applyIni(server);
    log.info(`${ed.label} is installed.`);
  },

  applyIni(server) {
    fs.mkdirSync(configDir(server), { recursive: true });
    const a = server.ark;
    const files = { gus: loadIni(server, 'gus'), game: loadIni(server, 'game') };
    const { gus, game } = files;
    // Keep hand edits made to the files since the panel last wrote them.
    for (const f of FIELDS) {
      const v = editedInFile(server, files, f);
      if (v !== undefined) a.settings[f.key] = v;
    }
    a.engrams = engramState(server, game);
    // Lines deleted from the extra boxes since the last write.
    for (const r of a.extraRemove || []) files[r.file].removeAll(r.section, r.key);
    const s = a.settings;
    for (const f of FIELDS) {
      if (!(f.key in s)) continue;
      files[f.file].set(f.section, f.iniKey || f.key, iniValue(f, s[f.key]));
    }
    const engrams = engramList(a.engrams);
    if (engrams) {
      game.removeAll(GM, ENGRAM_KEY);
      for (const n of engrams) game.add(GM, ENGRAM_KEY, n);
    } else if (a.engramsWritten && a.engramsWritten.length) {
      game.removeAll(GM, ENGRAM_KEY); // switched back to ARK's default
    }
    // Extra lines come after the form, so they win over a form field with the same key.
    for (const which of Object.keys(EXTRA)) {
      const lines = parseExtra(which, a.extraIni && a.extraIni[which]);
      for (const l of lines) files[which].removeAll(l.section, l.key);
      for (const l of lines) files[which].add(l.section, l.key, l.value);
    }
    a.extraRemove = [];
    // RCON must be on for the panel console, player list and graceful shutdown.
    gus.set('ServerSettings', 'RCONEnabled', 'True');
    gus.set('ServerSettings', 'RCONPort', server.ark.rconPort);
    gus.set('SessionSettings', 'Port', server.ark.port);
    if (server.ark.edition === 'ase') gus.set('SessionSettings', 'QueryPort', server.ark.queryPort);
    saveIni(server, 'gus', gus);
    saveIni(server, 'game', game);
    // What the files now say, to tell hand edits apart from the panel's own writes next time.
    a.iniWritten = {};
    for (const f of FIELDS) a.iniWritten[f.key] = files[f.file].get(f.section, f.iniKey || f.key) ?? null;
    a.engramsWritten = game.getAll(GM, ENGRAM_KEY);
  },

  // Called after the settings form is saved while the server is stopped, so the files match
  // the panel right away. While it runs, ARK would overwrite them on shutdown; the next start writes them.
  saveFiles(server) {
    this.applyIni(server);
  },

  async buildLaunch(server) {
    const a = server.ark;
    const exe = this.exePath(server);
    if (!exe) throw new HttpError(400, `${edition(server).label} servers only run on Windows.`);
    if (!fs.existsSync(exe)) throw new HttpError(400, 'Server files are missing. Use "Update / Validate" to (re)install.');
    this.applyIni(server);
    let url = `${a.map}?listen?Port=${a.port}?RCONEnabled=True?RCONPort=${a.rconPort}`;
    const args = [];
    if (a.edition === 'ase') {
      url += `?QueryPort=${a.queryPort}?MaxPlayers=${a.maxPlayers}`;
      if (a.mods.length) url += `?GameModIds=${a.mods.join(',')}`;
      if (a.altSaveDir) url += `?AltSaveDirectoryName=${a.altSaveDir}`;
      args.push(url, '-server');
      if (a.mods.length) args.push('-automanagedmods');
    } else {
      if (a.altSaveDir) url += `?AltSaveDirectoryName=${a.altSaveDir}`;
      args.push(url, `-WinLiveMaxPlayers=${a.maxPlayers}`);
      if (a.mods.length) args.push(`-mods=${a.mods.join(',')}`);
      if (a.passiveMods) args.push(`-passivemods=${a.passiveMods}`);
      if (a.pcOnly) args.push('-ServerPlatform=PC');
    }
    if (!a.battleye) args.push('-NoBattlEye');
    if (a.clusterId) {
      const clusterDir = path.join(path.dirname(server.dir), '_ark_clusters');
      fs.mkdirSync(clusterDir, { recursive: true });
      args.push(`-clusterid=${a.clusterId}`, `-ClusterDirOverride=${clusterDir}`);
    }
    if (a.showConsole) args.push('-log');
    if (a.activeEvent) args.push(`-ActiveEvent=${a.activeEvent}`);
    if (a.culture) args.push(`-culture=${a.culture}`);
    for (const f of LAUNCH_FIELDS) if (f.flag && a[f.name]) args.push(f.flag);
    args.push('-servergamelog');
    args.push(...splitArgs(a.extraArgs));
    return {
      command: exe,
      args,
      cwd: path.dirname(exe),
      logFile: path.join(server.dir, 'ShooterGame', 'Saved', 'Logs', 'ShooterGame.log'),
    };
  },

  // ARK has no stdin console. The server counts as up once RCON answers.
  async probeReady(server) {
    await rcon(server, 'ListPlayers');
    return true;
  },

  async stop(instance) {
    const server = instance.server;
    try {
      await rcon(server, 'SaveWorld');
      instance.appendConsole('[panel] World saved, shutting down...');
      await new Promise((r) => setTimeout(r, 3000));
      await rcon(server, 'DoExit').catch(() => {});
    } catch (err) {
      instance.appendConsole(`[panel] RCON unavailable (${err.message}); stopping the process.`);
      instance.kill();
    }
  },

  async sendCommand(instance, command) {
    const out = await rcon(instance.server, command.replace(/^\//, ''));
    instance.appendConsole(`[rcon] ${(out || '').trim() || '(no response)'}`);
    return out;
  },

  broadcastCommand(msg) {
    return `ServerChat ${msg}`;
  },

  async beforeBackup(instance) {
    await rcon(instance.server, 'SaveWorld').catch(() => {});
    await new Promise((r) => setTimeout(r, 5000));
  },

  async query(server) {
    const out = await rcon(server, 'ListPlayers');
    const players = [];
    for (const line of String(out || '').split(/\r?\n/)) {
      const m = /^\s*\d+\.\s*([^,]+),/.exec(line);
      if (m) players.push(m[1].trim());
    }
    return { online: players.length, max: server.ark.maxPlayers, players };
  },

  backupConfig(server) {
    return { root: path.join(server.dir, 'ShooterGame', 'Saved'), ignore: ['Logs/**', 'Crashes/**'] };
  },

  closeRcon(server) {
    const c = rconClients.get(server.id);
    if (c) c.close();
    rconClients.delete(server.id);
  },

  settingsSchema(server) {
    const ed = server.ark.edition;
    const groups = new Map(GROUPS.map((g) => [g, []]));
    for (const f of [...LAUNCH_FIELDS, ...FIELDS]) {
      if (f.editions && !f.editions.includes(ed)) continue;
      if (!groups.has(f.group)) groups.set(f.group, []);
      const field = {
        key: f.file ? 'ini.' + f.key : f.key,
        label: f.label,
        type: f.type,
        step: f.step,
        hint: f.hint,
        admin: f.admin,
        def: f.def,
        options: f.options,
        // Where the value ends up, so it can be matched against the ARK wiki.
        tip: f.file ? `${EXTRA[f.file].file} [${f.section}] ${f.iniKey || f.key}` : f.flag,
      };
      if (f.name === 'map') field.options = edition(server).maps;
      groups.get(f.group).push(field);
    }
    const eng = engramState(server, loadIni(server, 'game'));
    groups.set('Engram points', [
      {
        key: 'engram.mode',
        label: 'Engram points per level',
        type: 'select',
        options: [
          { value: 'default', label: 'ARK default' },
          { value: 'same', label: 'Same points every level' },
          { value: 'custom', label: 'Different points for some levels' },
        ],
        hint: engramSummary(eng),
        tip: `Game.ini [${GM}] ${ENGRAM_KEY} (one line per level)`,
      },
      { key: 'engram.levels', label: 'Number of levels', type: 'number', min: 1, step: 1, def: ENGRAM_LEVELS, hint: 'Your max player level. Raise it if you raised the level cap (LevelExperienceRampOverrides).' },
      { key: 'engram.points', label: 'Points per level', type: 'number', min: 0, step: 1, hint: 'Every level gets this, except levels listed below.' },
      { key: 'engram.custom', label: 'Points for specific levels', type: 'textarea', hint: 'With "Different points for some levels": one line per level or range, e.g. 1-10 = 8, then 11-60 = 20, then 61-105 = 40.' },
    ]);
    groups.set('Advanced: extra INI lines', [
      { key: 'extra.gus', label: 'Extra GameUserSettings.ini lines', type: 'textarea', admin: true, hint: 'Admin only. Key=Value per line, added to [ServerSettings]; start a block with [SectionName] to target another section.' },
      { key: 'extra.game', label: 'Extra Game.ini lines', type: 'textarea', admin: true, hint: 'Admin only. For repeated settings such as ConfigOverrideItemMaxQuantity, OverrideNamedEngramEntries, ConfigOverrideSupplyCrateItems, LevelExperienceRampOverrides. Added to [/script/shootergame.shootergamemode].' },
    ]);
    return {
      note: 'Saved straight into GameUserSettings.ini / Game.ini (and again on every start, since ARK rewrites them on shutdown). Changes you make to those files by hand show up here. Leave a field blank to use ARK\'s default (shown greyed out). Hover a label to see the INI key.',
      sections: [...groups].filter(([, fields]) => fields.length).map(([title, fields]) => ({ title, fields, collapsed: !OPEN_GROUPS.has(title) })),
    };
  },

  readSettings(server) {
    const a = server.ark;
    const out = {};
    for (const f of LAUNCH_FIELDS) out[f.key] = a[f.name] ?? (f.type === 'bool' ? false : '');
    const files = { gus: loadIni(server, 'gus'), game: loadIni(server, 'game') };
    for (const f of FIELDS) {
      let v = editedInFile(server, files, f);
      if (v === undefined) v = a.settings[f.key];
      if (v === undefined) v = files[f.file].get(f.section, f.iniKey || f.key);
      if (f.type === 'bool') v = v == null ? !!f.def : v === true || String(v).toLowerCase() === 'true';
      out['ini.' + f.key] = v ?? '';
    }
    for (const which of Object.keys(EXTRA)) out['extra.' + which] = (a.extraIni && a.extraIni[which]) || '';
    const eng = engramState(server, files.game);
    out['engram.mode'] = eng.mode || 'default';
    out['engram.levels'] = eng.levels ?? '';
    out['engram.points'] = eng.points ?? '';
    out['engram.custom'] = eng.custom || '';
    return out;
  },

  writeSettings(server, values, opts = {}) {
    const a = server.ark;
    // Check everything before changing anything, so a bad value doesn't leave half the form saved.
    const changes = [];
    let engrams = null;
    for (const [k, v] of Object.entries(values)) {
      if (k.startsWith('engram.')) {
        engrams = engrams || { ...(a.engrams || { mode: 'default', levels: null, points: null, custom: '' }) };
        const name = k.slice(7);
        const blank = v === '' || v === null || v === undefined;
        if (name === 'mode') engrams.mode = ENGRAM_MODES.includes(v) ? v : 'default';
        else if (name === 'custom') engrams.custom = String(v ?? '').replace(/\r\n?/g, '\n').trim();
        else if (name === 'levels' || name === 'points') {
          const n = blank ? null : Number(v);
          const max = name === 'levels' ? ENGRAM_MAX_LEVELS : 100000;
          if (n !== null && (!Number.isInteger(n) || n < (name === 'levels' ? 1 : 0) || n > max)) {
            throw new HttpError(400, name === 'levels' ? `Number of levels must be a whole number from 1 to ${ENGRAM_MAX_LEVELS}` : 'Engram points per level must be a whole number, 0 or more');
          }
          engrams[name] = n;
        }
      } else if (k.startsWith('launch.')) {
        const f = LAUNCH_FIELDS.find((x) => x.key === k);
        // extraArgs becomes the server's command line, so admin only.
        if (!f || (f.admin && !opts.admin)) continue;
        let val;
        if (f.type === 'number') val = Number(v) || a[f.name];
        else if (f.type === 'bool') val = !!v;
        else {
          val = String(v ?? '').trim();
          if (f.pattern && !f.pattern.test(val)) throw new HttpError(400, `${f.label}: "${val}" is not a valid value`);
          if (f.name === 'passiveMods') val = val.split(/[\s,]+/).filter(Boolean).join(',');
        }
        changes.push(() => (a[f.name] = val));
      } else if (k.startsWith('ini.')) {
        const f = FIELDS.find((x) => x.key === k.slice(4));
        if (!f) continue;
        const blank = v === '' || v === null || v === undefined;
        // null (not delete) so applyIni removes the line instead of keeping an old value.
        const val = blank ? null : f.type === 'bool' ? !!v : f.type === 'number' ? Number(v) : String(v);
        if (f.type === 'number' && !blank && !Number.isFinite(val)) throw new HttpError(400, `${f.label}: must be a number`);
        changes.push(() => (a.settings[f.key] = val));
      } else if (k.startsWith('extra.') && EXTRA[k.slice(6)]) {
        if (!opts.admin) continue;
        const which = k.slice(6);
        const text = String(v ?? '').replace(/\r\n?/g, '\n').trim();
        parseExtra(which, text);
        changes.push(() => {
          a.extraIni = a.extraIni || { gus: '', game: '' };
          if (a.extraIni[which] === text) return;
          // Clear the old block's keys on the next start, so deleting a line removes it from the file.
          const old = parseExtra(which, a.extraIni[which]).map((l) => ({ file: which, section: l.section, key: l.key }));
          a.extraRemove = [...(a.extraRemove || []), ...old];
          a.extraIni[which] = text;
        });
      }
    }
    if (engrams) {
      if (engrams.mode === 'same' && engrams.points == null) throw new HttpError(400, 'Enter the engram points per level');
      if (engrams.mode === 'custom' && engrams.points == null && !parseEngramRanges(engrams.custom).length) {
        throw new HttpError(400, 'Enter points per level, or levels like 1-10 = 8');
      }
      parseEngramRanges(engrams.custom);
      changes.push(() => (a.engrams = engrams));
    }
    // The form showed what the files say, hand edits included, so what it sends is newer than
    // those edits: mark them as seen so the next write doesn't bring them back over the save.
    const sent = FIELDS.filter((f) => 'ini.' + f.key in values);
    if (sent.length || engrams) {
      const files = { gus: loadIni(server, 'gus'), game: loadIni(server, 'game') };
      if (!a.iniWritten) {
        a.iniWritten = {};
        for (const f of FIELDS) if (f.key in a.settings) a.iniWritten[f.key] = iniValue(f, a.settings[f.key]);
      }
      for (const f of sent) a.iniWritten[f.key] = files[f.file].get(f.section, f.iniKey || f.key) ?? null;
      if (engrams) a.engramsWritten = files.game.getAll(GM, ENGRAM_KEY);
    }
    for (const apply of changes) apply();
    if (!a.settings.ServerAdminPassword) a.settings.ServerAdminPassword = randomPassword(14);
    if (!a.map) a.map = edition(server).maps[0];
    return { restartRequired: true };
  },
};

// ---- Mod configuration: mods keep their settings in their own INI sections ----
// ARK's own sections; everything else in the two files belongs to a mod (e.g. [AnnunakiGenesis]).
const VANILLA_SECTION = /^(ServerSettings|SessionSettings|MessageOfTheDay|ScalabilityGroups|Player\.Info|\/script\/.*)$/i;
const SECTION_RE = /^[A-Za-z0-9_. -]{1,64}$/;
const MOD_KEY_RE = /^[\w.()\[\]-]{1,128}$/;

function modSections(server) {
  const out = [];
  for (const which of ['gus', 'game']) {
    for (const sec of loadIni(server, which).sections) {
      if (VANILLA_SECTION.test(sec.name)) continue;
      out.push({ file: which, section: sec.name, keys: sec.lines.filter((l) => l.key).length });
    }
  }
  return out;
}

const modId = (file, section) => `${file}:${section}`;

const modImageUrl = (server, id) => `/api/servers/${server.id}/mod-image/${id}`;

// The loaded mods with their Workshop/CurseForge details and the INI sections their pages document.
async function modDetails(server, opts) {
  return modinfo.getModInfo(server.ark.mods, { edition: server.ark.edition, ...opts });
}

ark.listModConfigs = async function (server, opts = {}) {
  const infos = await modDetails(server, opts);
  const existing = modSections(server);
  const claimed = new Set();
  const mods = infos.map((info) => {
    const files = [];
    for (const doc of info.docs || []) {
      const have = existing.find((e) => e.section.toLowerCase() === doc.section.toLowerCase());
      const file = have ? have.file : doc.file;
      claimed.add(modId(file, (have || doc).section).toLowerCase());
      files.push({ file: modId(file, (have || doc).section), where: `${EXTRA[file].file} [${(have || doc).section}]`, documented: doc.settings.length, keys: have ? have.keys : 0 });
    }
    return { id: 'mod:' + info.id, modId: info.id, name: info.name || `Mod ${info.id}`, found: !!info.found, image: info.found && info.imageUrl ? modImageUrl(server, info.id) : null, url: info.url || null, files };
  });
  const other = existing.filter((e) => !claimed.has(modId(e.file, e.section).toLowerCase()));
  if (other.length) mods.push({ id: 'other', name: 'Other mod sections', files: other.map((e) => ({ file: modId(e.file, e.section), where: `${EXTRA[e.file].file} [${e.section}]`, keys: e.keys })) });
  return {
    kind: 'ini',
    note: 'Each mod with the settings its Workshop/CurseForge page documents, pre-filled with their defaults. Change a value to override it; settings left at the default stay out of your INI files (use "Write all defaults" to put them all in). Sections the mods wrote themselves are included.',
    mods,
  };
};

ark.readModConfig = async function (server, id) {
  const [which, section] = [id.slice(0, id.indexOf(':')), id.slice(id.indexOf(':') + 1)];
  if (!EXTRA[which]) throw new HttpError(404, 'Unknown file');
  const ini = loadIni(server, which);
  const sec = ini.section(section);
  const seen = new Map();
  if (sec) for (const l of sec.lines) if (l.key) seen.set(l.key.toLowerCase(), { key: l.key, values: [...((seen.get(l.key.toLowerCase()) || {}).values || []), l.value] });
  // Documentation for this section from the mods' pages.
  let doc = null;
  let mod = null;
  for (const info of await modDetails(server)) {
    const d = (info.docs || []).find((x) => x.section.toLowerCase() === section.toLowerCase());
    if (d) [doc, mod] = [d, info];
  }
  const typeOf = (v) => (/^(true|false)$/i.test(String(v).trim()) ? 'bool' : /^-?\d+(\.\d+)?$/.test(String(v).trim()) ? 'number' : 'text');
  const fields = [];
  for (const s of (doc && doc.settings) || []) {
    const inFile = seen.get(s.key.toLowerCase());
    const value = inFile ? inFile.values[inFile.values.length - 1] : s.def;
    const type = typeOf(s.def);
    fields.push({
      id: s.key, label: s.key, type, def: s.def, inFile: !!inFile, section: 'Documented settings',
      value: type === 'bool' ? /^true$/i.test(String(value).trim()) : value,
      hint: [s.doc, `Default: ${s.def}`, inFile ? '' : 'not in your INI yet'].filter(Boolean).join(' · '),
    });
    seen.delete(s.key.toLowerCase());
  }
  for (const { key, values } of seen.values()) {
    const base = { id: key, label: key, inFile: true, section: doc ? 'Also in your INI' : '' };
    if (values.length > 1) fields.push({ ...base, type: 'textarea', value: values.join('\n'), hint: 'Repeated setting: one value per line' });
    else fields.push({ ...base, type: typeOf(values[0]), value: typeOf(values[0]) === 'bool' ? /^true$/i.test(values[0].trim()) : values[0] });
  }
  return { file: id, format: 'ini', where: `${EXTRA[which].file} [${section}]`, fields, canAdd: true, documented: !!doc, mod: mod && { name: mod.name, url: mod.url } };
};

// values: { key: value } (existing or new keys). Only while the server is stopped: ARK writes its
// settings back on shutdown and would undo the change.
ark.writeModConfig = async function (server, id, { values, writeAll }, opts = {}) {
  if (opts.running) throw new HttpError(409, 'Stop the server first: ARK rewrites its INI files when it shuts down, which would undo the change.');
  const [which, section] = [id.slice(0, id.indexOf(':')), id.slice(id.indexOf(':') + 1)];
  if (!EXTRA[which]) throw new HttpError(404, 'Unknown file');
  if (!SECTION_RE.test(section) || VANILLA_SECTION.test(section)) throw new HttpError(400, 'Use a mod section name like AnnunakiGenesis (ARK\'s own sections are in the Settings tab)');
  const ini = loadIni(server, which);
  const sec = ini.section(section);
  const current = new Map();
  if (sec) for (const l of sec.lines) if (l.key) current.set(l.key, [...(current.get(l.key) || []), l.value]);
  // Documented settings still at their default stay out of the file, unless "Write all defaults".
  const docs = new Map();
  for (const info of await modDetails(server)) {
    for (const d of info.docs || []) if (d.section.toLowerCase() === section.toLowerCase()) for (const st of d.settings) docs.set(st.key.toLowerCase(), st.def);
  }
  const sameAsDefault = (key, v) => {
    const def = docs.get(key.toLowerCase());
    if (def === undefined) return false;
    const a = String(v).trim();
    const b = String(def).trim();
    return a.toLowerCase() === b.toLowerCase() || (a !== '' && b !== '' && Number(a) === Number(b));
  };
  let changed = 0;
  for (const [key, raw] of Object.entries(values || {})) {
    if (![...current.keys()].some((k) => k.toLowerCase() === key.toLowerCase()) && !writeAll && sameAsDefault(key, typeof raw === 'boolean' ? (raw ? 'True' : 'False') : raw)) continue;
    if (!MOD_KEY_RE.test(key)) throw new HttpError(400, `"${key}" isn't a valid setting name`);
    const vals = (typeof raw === 'boolean' ? [raw ? 'True' : 'False'] : String(raw ?? '').split(/\r?\n/)).map((v) => v.trim()).filter((v, i, a) => v !== '' || a.length === 1);
    const before = current.get(key) || [];
    if (JSON.stringify(before) === JSON.stringify(vals)) continue;
    ini.removeAll(section, key);
    for (const v of vals) if (v !== '') ini.add(section, key, v);
    changed++;
  }
  if (!sec && !changed) ini.section(section, true); // a new, still empty mod section
  if (changed || !sec) {
    fs.mkdirSync(configDir(server), { recursive: true });
    saveIni(server, which, ini);
  }
  return { changed };
};

module.exports = ark;
