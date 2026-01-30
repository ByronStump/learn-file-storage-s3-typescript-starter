import { getVideoAspectRatio, processVideoForFastStart } from "../src/api/videos"

const filePath = process.argv[2]
if (!filePath) {
  console.error("Usage: bun scripts/debug-ffprobe.ts <path-to-video>")
  process.exit(1)
}

await processVideoForFastStart(filePath)