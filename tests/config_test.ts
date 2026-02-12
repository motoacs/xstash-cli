import { assertEquals } from '@std/assert';
import { defaultConfig, readConfigFile } from '../src/utils/config.ts';

Deno.test('defaultConfig includes incremental bookmarks page size as null', () => {
  const config = defaultConfig();
  assertEquals(config.sync.incremental_bookmarks_page_size, null);
});

Deno.test('readConfigFile keeps configured incremental bookmarks page size', async () => {
  const dir = await Deno.makeTempDir();
  try {
    const path = `${dir}/config.json`;
    await Deno.writeTextFile(
      path,
      JSON.stringify({
        version: 1,
        sync: {
          incremental_bookmarks_page_size: 20,
        },
      }),
    );

    const config = await readConfigFile(path);
    assertEquals(config.sync.incremental_bookmarks_page_size, 20);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
