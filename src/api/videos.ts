import { respondWithJSON } from "./json";

import { type ApiConfig } from "../config";
import { S3Client, type BunRequest } from "bun";
import { BadRequestError, NotFoundError, UserForbiddenError } from "./errors";
import { getBearerToken, validateJWT } from "../auth";
import { getVideo, updateVideo, type Video } from "../db/videos";
import { randomBytes } from "node:crypto";
import { rm } from "fs/promises";

export async function handlerUploadVideo(cfg: ApiConfig, req: BunRequest) {
  const rngFileName = `${randomBytes(32).toString("base64url")}.mp4`
  const tempPath = `./tmp/${rngFileName}`
  try {
    const MAX_UPLOAD_SIZE = 1 << 30
    const { videoId } = req.params as { videoId?: string };
    if (!videoId) {
      throw new BadRequestError("Invalid video ID");
    }
    const token = getBearerToken(req.headers);
    const userID = validateJWT(token, cfg.jwtSecret);
    console.log("uploading video", videoId, "by user", userID);
    const videoMetadata = getVideo(cfg.db, videoId)
    
    if (!videoMetadata) {
      throw new NotFoundError("Couldn't find video metadata");
    }
    if (videoMetadata.userID !== userID) {
      throw new UserForbiddenError(`Error, current user is not the video owner`)
    }
    const formData = await req.formData()
    const file = formData.get("video")
    if (!(file instanceof File)) {
      throw new BadRequestError(`Error, couldn't get video from formData`)
    }
    if (file.type !== "video/mp4") {
      throw new BadRequestError(`Wrong file type`)
    }
    if (file.size > MAX_UPLOAD_SIZE) {
      throw new BadRequestError(`Error, video file is too big. Max 1GB`)
    }
    
    await Bun.write(tempPath, file)
    const aspectRatio = await getVideoAspectRatio(tempPath)
    const fileProcessedPath = await processVideoForFastStart(tempPath)
    const s3File = cfg.s3Client.file(`${aspectRatio}/${rngFileName}`, { bucket: cfg.s3Bucket })
    await s3File.write(Bun.file(fileProcessedPath), { type: file.type })
    console.log(cfg.s3CfDistribution)
    videoMetadata.videoURL = `${cfg.s3CfDistribution}/${aspectRatio}/${rngFileName}`
    updateVideo(cfg.db, videoMetadata)
    return respondWithJSON(200, videoMetadata);
  } finally {
    await rm(tempPath).catch(() => {})
    await rm(tempPath + ".processed").catch(() => {})
  }
}


export async function getVideoAspectRatio(filePath: string) {
  const proc = Bun.spawn(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "json", filePath], {
    stdout: "pipe",
    stderr: "pipe"
  })
  const exited = await proc.exited

  if (exited !== 0) {
    throw new Error(`Error`)
  }

  const stdoutText = await new Response(proc.stdout).text();
  const stdoutParsed = JSON.parse(stdoutText)
  const width = stdoutParsed.streams[0].width
  const height = stdoutParsed.streams[0].height
  const ratio = Number((width / height).toFixed(2))
  if (ratio === 0.56) {
    return "portrait"
  } else if (ratio === 1.78) {
    return "landscape"
  } else {
    return "other"
  }
}

export async function processVideoForFastStart(inputFilePath: string) {
  const outputFilePath = inputFilePath + ".processed"
  const proc = Bun.spawn(["ffmpeg", "-i", inputFilePath, "-movflags", "faststart", "-map_metadata", "0", "-codec", "copy", "-f", "mp4", outputFilePath], {
    stdout: "pipe"
  })
  const exited = await proc.exited

  if (exited !== 0) {
    throw new Error(`Error`)
  }
  return outputFilePath
  
}