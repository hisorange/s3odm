import { S3ODM } from '../src/s3odm';

const createODM = (): S3ODM => {
  return new S3ODM(
    'ACCESS_KEY',
    'SECRET_KEY',
    'https://test.host',
    'BUCKET_NAME',
  );
};

describe('Repository', () => {
  test('should create a valid repository', () => {
    const odm = createODM();

    const repository = odm.createRepository('test');

    expect(repository.tableName).toBe('test');
    expect(repository).toHaveProperty('deleteById');
    expect(repository).toHaveProperty('deleteAll');
    expect(repository).toHaveProperty('insert');
    expect(repository).toHaveProperty('findAll');
  });
});
