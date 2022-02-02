import { S3EventRecord } from 'aws-lambda';
import handler from './src/handler';

const res: any = handler(
  {
    Records: [
      {
        eventVersion: '2.1',
        eventSource: 'aws:s3',
        awsRegion: 'eu-central-1',
        eventTime: '2022-01-25T18:50:40.108Z',
        eventName: 'ObjectCreated:CompleteMultipartUpload',
        userIdentity: { principalId: 'AWS:AIDATMCMC4V5UVLOAMK7Q' },
        requestParameters: { sourceIPAddress: '80.187.81.158' },
        responseElements: {
          'x-amz-request-id': 'Q8GVQQ5C8MFFDVK6',
          'x-amz-id-2':
            'eVCIlvgN0f8GCL2sARuHtxUeHN+1D5nzGFFQOhX3ZPcjmV9JOCVJvzKMcCaZVmEDd9RbHx1V0lIbzaP2Iq7na/97GSs8uO35',
        },
        s3: {
          s3SchemaVersion: '1.0',
          configurationId: 'ab792830-e742-4652-a9d9-cd6a66fd77e1',
          bucket: {
            name: 'tagesform',
            ownerIdentity: {} as any,
            arn: 'arn:aws:s3:::tagesform',
          },
          object: {
            key: 'tagesform_8.5.mp3',
            size: 18484832,
            eTag: '1fef10876b3a320496a8af90de0a4d88-2',
            sequencer: '0061F0467070C93EA0',
          },
        },
      },
    ],
  },
  {} as any,
  null as any,
);

res
  .catch((err) => {
    console.error(err);
  })
  .then(() => {
    console.log('OK');
  });
