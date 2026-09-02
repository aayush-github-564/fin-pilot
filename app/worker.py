import logging

from arq.connections import RedisSettings

from app.core.config import settings

logger = logging.getLogger(__name__)


async def sample_task(ctx, message: str):
    logger.info(f"Worker received: {message}")
    return f"processed: {message}"


async def startup(ctx):
    logger.info("Worker starting up")


async def shutdown(ctx):
    logger.info("Worker shutting down")


class WorkerSettings:
    functions = [sample_task]
    on_startup = startup
    on_shutdown = shutdown
    redis_settings = RedisSettings.from_dsn(settings.redis_url)
