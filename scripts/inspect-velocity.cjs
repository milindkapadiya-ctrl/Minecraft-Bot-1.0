// Offline dependency evidence only; this neither connects nor modifies physics.
const { createRequire } = require("node:module");
const fromMineflayer = createRequire(require.resolve("mineflayer"));
const fromProtocol = createRequire(
  fromMineflayer.resolve("minecraft-protocol"),
);
const [read, write, size] = fromProtocol("./datatypes/lpVec3");
const { fromNotchVelocity } = fromMineflayer("./lib/conversions");
const data = fromMineflayer("minecraft-data")("26.1");
const input = { x: 0.4, y: 0.4, z: -0.2 };
const buffer = Buffer.alloc(size(input));
write(input, buffer, 0);
const decoded = read(buffer, 0).value;
console.log(
  JSON.stringify(
    {
      evidence:
        "offline codec roundtrip plus installed legacy conversion; not a live hit",
      mineflayer: require("mineflayer/package.json").version,
      protocol: fromMineflayer("minecraft-protocol/package.json").version,
      minecraftData: fromMineflayer("minecraft-data/package.json").version,
      packetSchema: data.protocol.play.toClient.types.packet_entity_velocity,
      input,
      decoded,
      legacyConverted: fromNotchVelocity(decoded),
      xScaleRatio: decoded.x / fromNotchVelocity(decoded).x,
    },
    null,
    2,
  ),
);
