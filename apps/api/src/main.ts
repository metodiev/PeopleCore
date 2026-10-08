import 'reflect-metadata';
// Populates process.env from apps/api/.env (and the repo-root .env) — must run
// before any module reads configuration.
import './config/load-env.js';
import { Logger, ValidationPipe, VersioningType } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { AppModule } from './app.module.js';
import { APP_CONFIG, type AppConfig } from './config/configuration.js';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter.js';

async function bootstrap(): Promise<void> {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create(AppModule, { bufferLogs: false });
  const config = app.get<AppConfig>(APP_CONFIG);

  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  app.enableCors({
    origin: config.corsOrigins,
    credentials: true,
    exposedHeaders: ['x-request-id'],
  });

  app.setGlobalPrefix(config.apiPrefix, { exclude: ['health', 'health/live', 'health/ready', 'metrics'] });
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: config.apiVersion });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
      transformOptions: { enableImplicitConversion: false },
    }),
  );
  app.useGlobalFilters(new AllExceptionsFilter());
  app.enableShutdownHooks();

  if (config.nodeEnv !== 'production') {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .setTitle('PeopleCore API')
        .setDescription(
          'Multi-tenant HR/ERP platform API. Authenticate with `POST /api/v1/auth/login`, then use the returned access token as a Bearer token.',
        )
        .setVersion('1.0')
        .addBearerAuth()
        .addTag('auth')
        .build(),
      { ignoreGlobalPrefix: false },
    );
    SwaggerModule.setup(`${config.apiPrefix}/docs`, app, document, {
      swaggerOptions: { persistAuthorization: true },
    });
  }

  if (config.listenSocket) {
    await app.listen(config.listenSocket);
    logger.log(`PeopleCore API listening on unix socket ${config.listenSocket}`);
  } else {
    await app.listen(config.port, '0.0.0.0');
    logger.log(`PeopleCore API listening on http://localhost:${config.port}/${config.apiPrefix}/v${config.apiVersion}`);
  }
  logger.log(`Environment: ${config.nodeEnv} · database driver: ${config.database.driver}`);
}

await bootstrap();
