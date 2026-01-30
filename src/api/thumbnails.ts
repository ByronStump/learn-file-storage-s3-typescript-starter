import { getBearerToken, validateJWT } from "../auth";
import { respondWithJSON } from "./json";
import { getVideo, updateVideo } from "../db/videos";
import type { ApiConfig } from "../config";
import type { BunRequest } from "bun";
import { BadRequestError, NotFoundError, UserForbiddenError } from "./errors";
import path from "node:path";
import { randomBytes } from "node:crypto";

export async function handlerUploadThumbnail(cfg: ApiConfig, req: BunRequest) {
  const { videoId } = req.params as { videoId?: string };
  if (!videoId) {
    throw new BadRequestError("Invalid video ID");
  }

  const token = getBearerToken(req.headers);
  const userID = validateJWT(token, cfg.jwtSecret);

  console.log("uploading thumbnail for video", videoId, "by user", userID);
  const formData = await req.formData()
  const file = formData.get("thumbnail")
  if (!(file instanceof File)) {
    throw new BadRequestError(`Error, couldn't get thumbnail from formData`)
  }
  if (file.type !== "image/jpeg" && file.type !== "image/png") {
    throw new BadRequestError(`Wrong file type`)
  }
  const MAX_UPLOAD_SIZE = 10 << 20
  if (file.size > MAX_UPLOAD_SIZE) {
    throw new BadRequestError(`Error, thumbnail file is too big. Max 10MB`)
  }
  const videoMetadata = getVideo(cfg.db, videoId)
  
  if (!videoMetadata) {
    throw new NotFoundError("Couldn't find video");
  }
  if (videoMetadata.userID !== userID) {
    throw new UserForbiddenError(`Error, current user is not the video owner`)
  }
  const imagePath = path.join(cfg.assetsRoot, randomBytes(32).toString("base64url"))
  const finalImagePath = `${imagePath}.${file.type.split("/")[1]}`
  Bun.write(finalImagePath, file)
  const thumbnailDataURL = `http://localhost:${cfg.port}/${finalImagePath}`
  videoMetadata.thumbnailURL = thumbnailDataURL
  updateVideo(cfg.db, videoMetadata)
  return respondWithJSON(200, videoMetadata);
}
