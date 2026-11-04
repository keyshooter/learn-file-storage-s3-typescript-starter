import { respondWithJSON } from "./json";

import { type ApiConfig } from "../config";
import type { BunRequest } from "bun";
import { BadRequestError, UserForbiddenError } from "./errors";
import { getBearerToken, validateJWT } from "../auth";
import { getVideo, updateVideo } from "../db/videos";
import path from "path";

const MAX_FILE_SIZE = 1 << 30;

type ffprobeStreams = {
  width: number;
  height: number;
};

type ffprobeOutput = {
  programs: Array<any>;
  stream_groups: Array<any>;
  streams: Array<ffprobeStreams>;
}

export async function handlerUploadVideo(cfg: ApiConfig, req: BunRequest) {
  const { videoId } = req.params as { videoId?: string };
  if (!videoId) {
    throw new BadRequestError("Invalid video ID");
  }

  const token = getBearerToken(req.headers);
  const userID = validateJWT(token, cfg.jwtSecret);
  const videoMetadata = getVideo(cfg.db, videoId);

  if (userID !== videoMetadata?.userID) {
    throw new UserForbiddenError("video is not yours");
  }

  const formData = await req.formData();
  const video = formData.get("video");

  if (!(video instanceof File)) {
    throw new BadRequestError("video is not a file");
  }

  if (video.size > MAX_FILE_SIZE) {
    throw new BadRequestError("video is too large");
  }

  const mimeType = video.type;
  if (mimeType !== "video/mp4") {
    throw new BadRequestError("video most be mp4");
  }
  const tmpFilePath = path.join(
    "/tmp",
    `${videoId}.mp4`,
  )
  const videoContent = await video.arrayBuffer();
  await Bun.write(tmpFilePath, videoContent);

  const aspectRatio = await getVideoAspectRatio(tmpFilePath);

  const s3File = cfg.s3Client.file(
    `${aspectRatio}/${videoId}.mp4`,
    {
      type: "video/mp4"
    }
  );

  await s3File.write(videoContent);
  videoMetadata.videoURL = `https://${cfg.s3Bucket}.s3.${cfg.s3Region}.amazonaws.com/${aspectRatio}/${videoId}.mp4`;

  updateVideo(cfg.db, videoMetadata);

  return respondWithJSON(200, videoMetadata);
}

export async function getVideoAspectRatio(filePath: string) {
  const proc = Bun.spawn([
    "ffprobe",
    "-v",
    "error",
    "-select_streams",
    "v:0",
    "-show_entries",
    "stream=width,height",
    "-of",
    "json",
    filePath
  ], { stderr: "pipe", stdout: "pipe" });

  if (await proc.exited !== 0) {
    const stderrText = await new Response(proc.stderr).text();
    throw new BadRequestError(`failed to load file data: ${stderrText}`);
  }

  const videoData: ffprobeOutput = await new Response(proc.stdout).json();

  const ratio: number = Math.floor(videoData?.streams[0].width / videoData?.streams[0].height);

  if (ratio === 1) {
    return "landscape";
  } else if (ratio === 0) {
    return "portrait";
  } else {
    return "other";
  }
}
