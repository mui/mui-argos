import { S3Client } from "@aws-sdk/client-s3";

let client: S3Client;

export type { S3Client } from "@aws-sdk/client-s3";

export const s3 = () => {
  if (!client) {
    client = new S3Client({ region: "eu-west-1" });
  }
  return client;
};
