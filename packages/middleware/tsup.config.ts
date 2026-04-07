import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    express: 'src/express.ts',
    nestjs: 'src/nestjs.ts',
    fastify: 'src/fastify.ts',
  },
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  external: ['express', 'fastify', '@nestjs/common', '@nestjs/core'],
});
