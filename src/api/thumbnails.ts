import { getBearerToken, validateJWT } from "../auth";
import { respondWithJSON } from "./json";
import { getVideo, getVideos, updateVideo } from "../db/videos";
import type { ApiConfig } from "../config";
import type { BunRequest } from "bun";
import { BadRequestError, NotFoundError, UserForbiddenError } from "./errors";
import path from "path";

const MAX_UPLOAD_SIZE = 10 << 20;
const ALLOWED_IMAGE_FORMATS = [
  "image/jpg",
  "image/png",
];

export async function handlerUploadThumbnail(cfg: ApiConfig, req: BunRequest) {
  const { videoId } = req.params as { videoId?: string };
  if (!videoId) {
    throw new BadRequestError("Invalid video ID");
  }

  const token = getBearerToken(req.headers);
  const userID = validateJWT(token, cfg.jwtSecret);

  console.log("uploading thumbnail for video", videoId, "by user", userID);

  const formData = await req.formData();
  const thumbnail = formData.get("thumbnail");
  if (!(thumbnail instanceof File)) {
    throw new BadRequestError("thumbnail is not a file");
  }
  if (thumbnail.size > MAX_UPLOAD_SIZE) {
    throw new BadRequestError("file is too large");
  }
  const mediaType = thumbnail.type;
  if (!ALLOWED_IMAGE_FORMATS.includes(mediaType)) {
    throw new BadRequestError("unsupported file");
  }

  const [_, fileType] = mediaType.split("/");
  const thumbnailRaw = await thumbnail.arrayBuffer();
  const filePath = path.join(
    cfg.assetsRoot,
    `${videoId}.${fileType}`,
  );
  Bun.write(
    filePath,
    thumbnailRaw,
  );

  const videoMetadata = getVideo(cfg.db, videoId);
  if (videoMetadata?.userID !== userID) {
    throw new UserForbiddenError("video is not yours");
  }

  const url = `http://localhost:${cfg.port}/assets/${videoId}.${fileType}`;
  videoMetadata.thumbnailURL = url;
  updateVideo(cfg.db, videoMetadata);

  return respondWithJSON(200, videoMetadata);
}
