/**
 * The persistence layer (docs/design.md §8).
 *
 *   db.ts          IndexedDB, one transaction per write, cross-tab notification
 *   serialise.ts   documents, migrations, validation, and the merge rule
 *   backup.ts      the backup folder, rotating snapshots, manual export
 *   auto-backup.ts what makes layer 2 automatic: on open, and when dirty
 *   durability.ts  persistent-storage permission and storage estimates
 *
 * The three layers of §8.3 are: claim persistence (`durability`), back up to a
 * real folder (`backup`), and always allow a manual export (`backup` again).
 * Import and restore are one function — `mergeDocument`.
 */

export type {
  MergeResult,
  MergeStats,
  RecordKind,
  Store,
  StoreChange,
  TimelineDocument,
} from './contract';
export { SCHEMA_VERSION } from './contract';

export { DEFAULT_DB_NAME, createIndexedDbStore, deleteStore } from './db';

export {
  DocumentFormatError,
  FUTURE_TOLERANCE_MS,
  GENERATOR,
  MIGRATIONS,
  RECORD_KINDS,
  SchemaVersionError,
  asDocument,
  compareTimestamps,
  fromDocument,
  isWellFormedRecord,
  mergeDocument,
  migrate,
  parseDocument,
  serialiseDocument,
  toDocument,
} from './serialise';
export type { MergeOptions, Migration, ToDocumentOptions } from './serialise';

export {
  BACKUP_STALE_DAYS,
  DEFAULT_BACKUP_DB_NAME,
  SNAPSHOT_RETENTION,
  backupStatus,
  backupSupport,
  chooseBackupFolder,
  createBackupManager,
  daysSince,
  downloadExport,
  exportFilename,
  forgetBackupFolder,
  getBackupFolder,
  isBackupSupported,
  isSnapshotName,
  lastBackupAt,
  lastExportAt,
  markBackedUp,
  markExported,
  requestBackupPermission,
  snapshotFilename,
  snapshotsToPrune,
  writeSnapshot,
  writeSnapshotTo,
} from './backup';
export type {
  BackupManager,
  BackupStatus,
  BackupSupport,
  ChooseFolderResult,
  CopyKind,
  DownloadExportOptions,
  ExportResult,
  HandlePermission,
  SnapshotDirectory,
  SnapshotEntry,
  SnapshotFile,
  SnapshotResult,
  SnapshotWritable,
  WriteSnapshotOptions,
} from './backup';

export { AUTO_BACKUP_INTERVAL_MS, startAutoBackup } from './auto-backup';
export type { AutoBackup, AutoBackupOptions, AutoBackupReason } from './auto-backup';

export {
  guessPrivateBrowsing,
  persistenceState,
  requestPersistence,
  storageEstimate,
} from './durability';
export type {
  PersistenceResult,
  PrivateBrowsingGuess,
  StorageEstimateResult,
} from './durability';
