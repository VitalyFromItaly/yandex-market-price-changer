import type { OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';

import { Injectable, Logger } from '@nestjs/common';

import { ErrorReporter } from '../errors/error-reporter.service';

import {
  MEMORY_SAMPLE_INTERVAL_MS,
  MemoryPressureError,
  activeMemoryJobs,
  memoryAlertText,
  nextMemoryAlertState,
  sampleActiveJobs,
  snapshotMemory,
} from './memory-watch.domain';

/**
 * Сэмплер RSS раз в секунду: поднимает пики идущих задач (`traceMemory`) и при
 * пересечении порога шлёт админам алерт со списком этих задач. На `setInterval`,
 * а не Bull, — по доводу `HealthMonitorService`: в момент нехватки памяти Redis и
 * Mongo могут уже не отвечать. `ErrorReporter` не бросает и не блокирует.
 */
@Injectable()
export class MemoryWatchService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(MemoryWatchService.name);
  private timer?: NodeJS.Timeout;
  private armed = true;

  constructor(private readonly errors: ErrorReporter) {}

  onApplicationBootstrap(): void {
    this.timer = setInterval(() => this.tick(), MEMORY_SAMPLE_INTERVAL_MS);
    // Не держать event loop: завершение по SIGTERM не должно ждать сэмплера.
    this.timer.unref();
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  private tick(): void {
    const memory = snapshotMemory();
    sampleActiveJobs(memory);
    const next = nextMemoryAlertState(this.armed, memory.rss);
    this.armed = next.armed;
    if (!next.alert) return;
    const text = memoryAlertText(memory, activeMemoryJobs(), Date.now());
    this.logger.warn(text);
    void this.errors.report({
      error: new MemoryPressureError(text),
      source: 'process',
      context: 'memory',
      action: 'самопроверка памяти процесса',
    });
  }
}
