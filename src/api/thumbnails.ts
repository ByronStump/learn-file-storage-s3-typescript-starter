import { getBearerToken, validateJWT } from "../auth";
import { respondWithJSON } from "./json";
import { getVideo, getVideos, updateVideo } from "../db/videos";
import type { ApiConfig } from "../config";
import type { BunRequest } from "bun";
import { BadRequestError, NotFoundError, UserForbiddenError } from "./errors";

type Thumbnail = {
  data: ArrayBuffer;
  mediaType: string;
};

const videoThumbnails: Map<string, Thumbnail> = new Map();

export async function handlerGetThumbnail(cfg: ApiConfig, req: BunRequest) {
  const { videoId } = req.params as { videoId?: string };
  if (!videoId) {
    throw new BadRequestError("Invalid video ID");
  }

  const video = getVideo(cfg.db, videoId);
  if (!video) {
    throw new NotFoundError("Couldn't find video");
  }

  const thumbnail = videoThumbnails.get(videoId);
  if (!thumbnail) {
    throw new NotFoundError("Thumbnail not found");
  }

  return new Response(thumbnail.data, {
    headers: {
      "Content-Type": thumbnail.mediaType,
      "Cache-Control": "no-store",
    },
  });
}

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
  const MAX_UPLOAD_SIZE = 10 << 20
  if (file.size > MAX_UPLOAD_SIZE) {
    throw new BadRequestError(`Error, thumbnail file is too big. Max 10MB`)
  }
  const imageData = await file.arrayBuffer()
  const videoMetadata = getVideo(cfg.db, videoId)
  if (!videoMetadata) {
    throw new NotFoundError("Couldn't find video");
  }
  if (videoMetadata.userID !== userID) {
    throw new UserForbiddenError(`Error, current user is not the video owner`)
  }
  videoThumbnails.set(videoId, {
    data: imageData,
    mediaType: file.type
  })
  const thumbnailURL = `http://localhost:${cfg.port}/api/thumbnails/${videoId}`
  videoMetadata.thumbnailURL = thumbnailURL
  updateVideo(cfg.db, videoMetadata)
  return respondWithJSON(200, videoMetadata);
}
