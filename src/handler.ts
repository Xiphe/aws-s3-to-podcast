import { S3Handler } from 'aws-lambda';
import NodeID3, { Tags } from 'node-id3';
import path from 'path';
import YAML from 'yaml';
import TranscribeService from 'aws-sdk/clients/transcribeservice';
import S3 from 'aws-sdk/clients/s3';
import { zonedTimeToUtc } from 'date-fns-tz';
import {
  millisecondsToHours,
  hoursToMilliseconds,
  millisecondsToMinutes,
  minutesToMilliseconds,
  millisecondsToSeconds,
} from 'date-fns';
import { createHash } from 'crypto';
import mime from 'mime';

const AWS_REGION = 'eu-central-1';
const GENERATED_FOLDER = 'X';
const TIMEZONE = 'Europe/Berlin';
const LANGUAGE_CODE = 'de-DE';

function parseText(comment: string): Record<string, any> {
  const text = comment.split(/^\s*--\s*\n/gm);
  const extra: unknown = (text[1] && YAML.parse(text[1])) || {};
  if (!isRecord(extra)) {
    throw new Error('Unexpected extra in text');
  }
  const { tags: t, date, ...extraRest } = extra;

  return {
    text: text[0].trim(),
    tags: Array.isArray(t)
      ? t
      : typeof t === 'string'
      ? t.split(',').map((t) => t.trim())
      : undefined,
    date:
      typeof date === 'string'
        ? zonedTimeToUtc(new Date(date), TIMEZONE).toISOString()
        : undefined,
    extra: extraRest,
  };
}

function extraData(Key: string, tags: Tags) {
  const extraData: Record<string, any> = {};
  if (Key.startsWith('s2')) {
    extraData.season = 2;
  }

  const m = tags.title.match(/Tagesform\s*([0-9,.]+)/);
  if (m && m[1]) {
    extraData.episode = parseInt(m[1], 10);
  }

  return extraData;
}

const s3 = new S3({ region: AWS_REGION });
const ts = new TranscribeService({
  region: AWS_REGION,
});

const handler: S3Handler = async ({ Records }, context) => {
  await Promise.all(
    Records.map(async (record) => {
      const Bucket = record.s3.bucket.name;
      const Key = record.s3.object.key.replace(/\+/g, ' ');
      const Folder = path.dirname(Key);
      const FileName = path.basename(Key, path.extname(Key));
      const file = await s3
        .getObject({
          Bucket,
          Key,
        })
        .promise();

      if (!(file.Body instanceof Buffer)) {
        throw new Error('Expected Body to be Buffer');
      }

      const tags = NodeID3.read(file.Body);

      const length = parseInt(tags.length, 10);
      const data: Record<string, any> = {
        title: tags.title,
        length,
        file: Key,
        duration: humanReadableDuration(length),
        ...extraData(Key, tags),
        ...parseText(tags.comment.text),
      };

      if (tags.image && typeof tags.image !== 'string') {
        data.image = await makeCoverAvailable(
          tags.image.imageBuffer,
          tags.image.mime,
          Folder,
          Bucket,
        );
      }

      const metaFolder = path.join(Folder, GENERATED_FOLDER, 'meta');
      const metaKey = path.join(metaFolder, `${FileName}.json`);

      try {
        const existing = await s3.getObject({ Key: metaKey, Bucket }).promise();
        const prevData = JSON.parse(existing.Body.toString());
        if (!prevData.transcription || prevData.length !== data.length) {
          throw new Error('Length different');
        }
        data.transcription = prevData.transcription;
      } catch {
        const transcriptKey = path.join(
          Folder,
          GENERATED_FOLDER,
          'transcript',
          `${FileName.replace(/[^a-zA-Z0-9-_.!*'()/]/g, '-').replace(
            /-+/g,
            '-',
          )}.json`,
        );
        const jobName = `${FileName.replace(/[^0-9a-zA-Z._-]/g, '-')
          .replace(/-+/g, '-')
          .substring(0, 100)}--${Date.now()}`;

        await ts
          .startTranscriptionJob({
            LanguageCode: LANGUAGE_CODE,
            Media: {
              MediaFileUri: `s3://${Bucket}/${Key}`,
            },
            MediaFormat: 'mp3',
            TranscriptionJobName: jobName,
            OutputBucketName: Bucket,
            OutputKey: transcriptKey,
          })
          .promise();
        console.log('Started Transcription job', jobName);

        data.transcription = transcriptKey;
      }

      console.log(`Extracted Meta`, data);
      await s3
        .putObject({
          Bucket,
          Key: metaKey,
          Body: JSON.stringify(data),
        })
        .promise();

      const { Contents } = await s3
        .listObjects({
          Bucket,
          Prefix: metaFolder,
        })
        .promise();

      const index = Contents.map(({ Key }) => path.relative(metaFolder, Key));

      await s3
        .putObject({
          Bucket,
          Key: path.join(metaFolder, 'index.json'),
          Body: JSON.stringify(index),
        })
        .promise();
      console.log('Index updated');
    }),
  );
};

function isRecord(thing: unknown): thing is Record<string, unknown> {
  return typeof thing === 'object' && thing !== null;
}

function humanReadableDuration(durationMs: number) {
  const hours = millisecondsToHours(durationMs);
  durationMs -= hoursToMilliseconds(hours);
  const minutes = millisecondsToMinutes(durationMs);
  durationMs -= minutesToMilliseconds(minutes);
  const seconds = millisecondsToSeconds(durationMs);

  return [hours, minutes, seconds]
    .map((t) => String(t).padStart(2, '0'))
    .join(':');
}

function hashBuffer(buf: Buffer) {
  return createHash('sha256').update(buf).digest('hex');
}

async function makeCoverAvailable(
  cover: Buffer,
  mimeType: string,
  Folder: string,
  Bucket: string,
) {
  const hash = hashBuffer(cover).substring(0, 16);

  const imageKey = path.join(
    Folder,
    GENERATED_FOLDER,
    'img',
    `${hash}.${
      (mimeType.includes('/') ? mime.getExtension(mimeType) : mimeType) || 'jpg'
    }`,
  );

  try {
    await s3
      .headObject({
        Bucket,
        Key: imageKey,
      })
      .promise();

    return imageKey;
  } catch (err) {
    if (err.code === 'NotFound') {
      await s3
        .putObject({
          Bucket,
          Key: imageKey,
          Body: cover,
        })
        .promise();
      console.log('Uploaded new cover', imageKey);
      return imageKey;
    } else {
      throw err;
    }
  }
}

export default handler;
