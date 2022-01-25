import { S3Handler } from 'aws-lambda';

const handler: S3Handler = async ({ Records }, context) => {
  console.log(Records[0]);
};

export default handler;
