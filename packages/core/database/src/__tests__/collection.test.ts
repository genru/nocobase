import { Collection } from '../collection';
import { Database } from '../database';
import { mockDatabase } from './index';
import { IdentifierError } from '../errors/identifier-error';

const pgOnly = () => (process.env.DB_DIALECT == 'postgres' ? it : it.skip);
describe('collection', () => {
  let db: Database;

  beforeEach(async () => {
    db = mockDatabase({
      logging: console.log,
    });

    await db.clean({ drop: true });
  });

  afterEach(async () => {
    await db.close();
  });

  it('should not throw error when create empty collection in sqlite and mysql', async () => {
    if (!db.inDialect('sqlite', 'mysql')) {
      return;
    }

    db.collection({
      name: 'empty',
      timestamps: false,
      autoGenId: false,
      fields: [],
    });

    let error;

    try {
      await db.sync({
        force: false,
        alter: {
          drop: false,
        },
      });
    } catch (e) {
      error = e;
    }

    expect(error).toBeUndefined();
  });

  pgOnly()('can create empty collection', async () => {
    db.collection({
      name: 'empty',
      timestamps: false,
      autoGenId: false,
      fields: [],
    });

    await db.sync({
      force: false,
      alter: {
        drop: false,
      },
    });

    expect(db.getCollection('empty')).toBeInstanceOf(Collection);
  });

  test('tree: should create properly', async () => {
    const category = db.collection({
      name: 'categories',
      tree: 'adjacency-list',
      fields: [
        {
          type: 'string',
          name: 'name',
        }
      ],
    });

    await db.sync();
    const proxy = category.repository;
    const lv1 = await proxy.create({values: {name: "lv1", children: [{name: 'lv11'}, {name: 'lv12'}]}});
    const lv0 = await proxy.create({values: {name: "lv0", children:[lv1.id]}})
    const categories = await proxy.find({ offset: 0, limit: 10, appends: ['children']});

    expect(lv0).toBeDefined();
    expect(lv0.id).toBe(4);
    expect(categories[0].path).toBe('4.1');
    expect(categories[0].hierarchyLevel).toBe(2);
    expect(categories[1].path).toBe('4.1.2');
    expect(categories[1].hierarchyLevel).toBe(3);
  })

  test('tree: should find with appends properly', async () => {
    const Tag = db.collection({
      name: 'tags',
      fields: [
        { type: 'belongsToMany', name: 'categories', through: 'categories_tags' },
        { type: 'string', name: 'name' },
      ],
    });

    const category = db.collection({
      name: 'categories',
      tree: 'adjacency-list',
      fields: [
        {
          type: 'string',
          name: 'name',
        },
        { type: 'belongsToMany', name: 'tags', through: 'categories_tags' },
      ],
    });

    await db.sync();
    const proxy = category.repository;
    const lv1 = await proxy.create({values: {
      name: "lv1", 
      children: [{name: 'lv11', tags:[{name: 't1'}, {name:'t2'}]}, {name: 'lv12', tags:[]}]
    }});
    const categories = await proxy.find({ tree: true, offset: 0, limit: 10, appends: ['tags']} as any);
    // console.info(JSON.stringify(categories.map(i=>i.toJSON()),null,2));
    expect(categories[0].toJSON().children).toBeDefined();
    // expect(categories[0].children).toBeDefined();
  })

  test('removeFromDb', async () => {
    await db.clean({ drop: true });
    const collection = db.collection({
      name: 'test',
      fields: [
        {
          type: 'string',
          name: 'name',
        },
      ],
    });
    await db.sync();

    const field = collection.getField('name');
    const r1 = await field.existsInDb();
    expect(r1).toBe(true);
    await field.removeFromDb();
    const r2 = await field.existsInDb();
    expect(r2).toBe(false);

    const r3 = await collection.existsInDb();
    expect(r3).toBe(true);
    await collection.removeFromDb();
    const r4 = await collection.existsInDb();
    expect(r4).toBe(false);
  });

  test('collection disable authGenId', async () => {
    const Test = db.collection({
      name: 'test',
      autoGenId: false,
      fields: [{ type: 'string', name: 'uid', primaryKey: true }],
    });

    const model = Test.model;

    await db.sync();
    expect(model.rawAttributes['id']).toBeUndefined();
  });

  test('new collection', async () => {
    const collection = new Collection(
      {
        name: 'test',
      },
      { database: db },
    );

    expect(collection.name).toEqual('test');
  });

  test('collection create field', async () => {
    const collection = new Collection(
      {
        name: 'user',
      },
      { database: db },
    );

    collection.addField('age', {
      type: 'integer',
    });

    const ageField = collection.getField('age');
    expect(ageField).toBeDefined();
    expect(collection.hasField('age')).toBeTruthy();
    expect(collection.hasField('test')).toBeFalsy();

    collection.removeField('age');
    expect(collection.hasField('age')).toBeFalsy();
  });

  test('collection set fields', () => {
    const collection = new Collection(
      {
        name: 'user',
      },
      { database: db },
    );

    collection.setFields([{ type: 'string', name: 'firstName' }]);
    expect(collection.hasField('firstName')).toBeTruthy();
  });

  test('update collection field', async () => {
    const collection = new Collection(
      {
        name: 'posts',
        fields: [{ type: 'string', name: 'title' }],
      },
      {
        database: db,
      },
    );
    expect(collection.hasField('title')).toBeTruthy();

    collection.updateField('title', {
      type: 'string',
      name: 'content',
    });

    expect(collection.hasField('title')).toBeFalsy();
    expect(collection.hasField('content')).toBeTruthy();
  });

  test('collection with association', async () => {
    const User = db.collection({
      name: 'users',
      fields: [
        { type: 'string', name: 'name' },
        { type: 'integer', name: 'age' },
        { type: 'hasMany', name: 'posts' },
      ],
    });

    const Post = db.collection({
      name: 'posts',
      fields: [
        { type: 'string', name: 'title' },
        { type: 'string', name: 'content' },
        {
          type: 'belongsTo',
          name: 'user',
        },
        {
          type: 'hasMany',
          name: 'comments',
        },
      ],
    });

    const Comment = db.collection({
      name: 'comments',
      fields: [
        { type: 'string', name: 'content' },
        { type: 'string', name: 'comment_as' },
        { type: 'belongsTo', name: 'post' },
      ],
    });

    expect(User.model.associations['posts']).toBeDefined();
    expect(Post.model.associations['comments']).toBeDefined();

    expect(User.model.associations['posts'].target.associations['comments']).toBeDefined();
  });
});

describe('collection sync', () => {
  let db: Database;

  beforeEach(async () => {
    db = mockDatabase();
  });

  afterEach(async () => {
    await db.close();
  });

  test('sync fields', async () => {
    const collection = new Collection(
      {
        name: 'users',
      },
      { database: db },
    );

    collection.setFields([
      { type: 'string', name: 'firstName' },
      { type: 'string', name: 'lastName' },
      { type: 'integer', name: 'age' },
    ]);

    await collection.sync();
    const tableFields = await (<any>collection.model).queryInterface.describeTable(`${db.getTablePrefix()}users`);

    expect(tableFields).toHaveProperty('firstName');
    expect(tableFields).toHaveProperty('lastName');
    expect(tableFields).toHaveProperty('age');
  });

  test('sync with association not exists', async () => {
    const collection = new Collection(
      {
        name: 'posts',
        fields: [
          { type: 'string', name: 'title' },
          { type: 'belongsTo', name: 'users' },
        ],
      },
      { database: db },
    );

    await collection.sync();

    const model = collection.model;

    const tableFields = await (<any>model).queryInterface.describeTable(`${db.getTablePrefix()}posts`);

    expect(tableFields['userId']).toBeUndefined();
  });

  test('sync with association', async () => {
    new Collection(
      {
        name: 'tags',
        fields: [{ type: 'string', name: 'name' }],
      },
      { database: db },
    );

    const collection = new Collection(
      {
        name: 'posts',
        fields: [
          { type: 'string', name: 'title' },
          { type: 'belongsToMany', name: 'tags' },
        ],
      },
      {
        database: db,
      },
    );

    const model = collection.model;
    await collection.sync();
    const tableFields = await (<any>model).queryInterface.describeTable(`${db.getTablePrefix()}postsTags`);
    expect(tableFields['postId']).toBeDefined();
    expect(tableFields['tagId']).toBeDefined();
  });

  test('limit table name length', async () => {
    const longName =
      'this_is_a_very_long_table_name_that_should_be_truncated_this_is_a_very_long_table_name_that_should_be_truncated';

    let error;

    try {
      const collection = new Collection(
        {
          name: longName,
          fields: [{ type: 'string', name: 'test' }],
        },
        {
          database: db,
        },
      );
    } catch (e) {
      error = e;
    }

    expect(error).toBeInstanceOf(IdentifierError);
  });

  test('limit field name length', async () => {
    const longFieldName =
      'this_is_a_very_long_field_name_that_should_be_truncated_this_is_a_very_long_field_name_that_should_be_truncated';

    let error;

    try {
      const collection = new Collection(
        {
          name: 'test',
          fields: [{ type: 'string', name: longFieldName }],
        },
        {
          database: db,
        },
      );
    } catch (e) {
      error = e;
    }

    expect(error).toBeInstanceOf(IdentifierError);
  });
});
