/**
 * The persistence layer (docs/design.md §8).
 *
 *   db.ts          IndexedDB, one transaction per write, cross-tab notification
 *   serialise.ts   documents, migrations, and the merge rule
 *   backup.ts      the backup folder, rotating snapshots, manual export
 *   durability.ts  persistent-storage permission and storage estimates
 *
 * The three layers of §8.3 are: claim persistence (`durability`), back up to a
 * real folder (`backup`), and always allow a manual export (`backup` again).
 * Import, restore and pack install are one function — `mergeDocument`.
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
  GENERATOR,
  MIGRATIONS,
  RECORD_KINDS,
  SchemaVersionError,
  asDocument,
  compareTimestamps,
  fromDocument,
  mergeDocument,
  migrate,
  parseDocument,
  serialiseDocument,
  toDocument,
} from './serialise';
export type { Migration, ToDocumentOptions } from './serialise';

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
  forgetBackupFolder,
  getBackupFolder,
  isBackupSupported,
  isSnapshotName,
  lastBackupAt,
  markBackedUp,
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
  DownloadExportOptions,
  ExportResult,
  HandlePermission,
  SnapshotDirectory,
  SnapshotFile,
  SnapshotResult,
  SnapshotWritable,
  WriteSnapshotOptions,
} from './backup';

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
