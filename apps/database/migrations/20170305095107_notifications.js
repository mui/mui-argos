/**
 * @param {import('knex').Knex} knex
 */
export const up = async (knex) => {
  await knex.schema
    .raw(
      `CREATE TYPE build_notifications_type AS ENUM ('progress', 'no-diff-detected', 'diff-detected')`
    )
    .createTable("build_notifications", (table) => {
      table.bigIncrements("id").primary();
      table.specificType("type", "build_notifications_type").notNullable();
      table.specificType("jobStatus", "job_status").notNullable();
      table.bigInteger("buildId").notNullable().index();
      table.foreign("buildId").references("builds.id");
      table.dateTime("createdAt").notNullable();
      table.dateTime("updatedAt").notNullable();
    });
};

/**
 * @param {import('knex').Knex} knex
 */
export const down = async (knex) => {
  await knex.schema
    .dropTableIfExists("build_notifications")
    .raw(`DROP TYPE build_notifications_type`);
};
