// Tipos tomados del contrato (Swagger / openapi.json de la API de Lumon).

export type Permission =
  | 'files:read'
  | 'files:refine'
  | 'refiners:read'
  | 'refiners:write'
  | 'media:upload'
  | 'incidents:read'
  | 'incidents:create'
  | 'team:manage';

export interface Health {
  status: 'ok';
  service: string;
  time: string;
}

export interface User {
  id: number;
  email: string;
  displayName: string;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface LoginResponse extends TokenPair {
  user: User;
}

export interface RegisterResponse extends TokenPair {
  user: User;
  team: { code: string; name: string };
}

export interface ClearanceStatus {
  granted: boolean;
  grantedAt: string | null;
}

export interface Me {
  id: number;
  email: string;
  displayName: string;
  team: { code: string; name: string };
  role: { code: string; name: string };
  permissions: Permission[];
  clearance: ClearanceStatus;
}

export type BinCode = 'WO' | 'FC' | 'DR' | 'MA';
export const BIN_CODES: readonly BinCode[] = ['WO', 'FC', 'DR', 'MA'];

export interface Progress {
  WO: number;
  FC: number;
  DR: number;
  MA: number;
  overall: number;
}

export type FileStatus = 'ACTIVE' | 'COMPLETE';

export interface DataFile {
  id: number;
  name: string;
  rows: number;
  cols: number;
  tileSize: number;
  status: FileStatus;
  progress: Progress;
  refinedGroups: number;
  totalGroups: number;
  mistakes: number;
  updatedAt: string;
}

export interface FilePage {
  content: DataFile[];
  totalElements: number;
  totalPages: number;
  page: number;
  size: number;
}

export interface Rules {
  tremorThreshold: number;
  connectivity: 4 | 8;
  minGroupSize: number;
  maxGroupSize: number;
  binning: {
    strategy: 'DIGIT_SUM_MOD' | 'MAX_DIGIT_MOD';
    order: BinCode[];
  };
}

export interface Tile {
  tileRow: number;
  tileCol: number;
  originRow: number;
  originCol: number;
  rows: number;
  cols: number;
  values: string;
  tremor: string;
  bins: string;
  version: number;
}

export interface CellRef {
  r: number;
  c: number;
}

export interface RefineRequest {
  bin: BinCode;
  cells: CellRef[];
}

export interface RefineResult {
  refinementId: number;
  bin: BinCode;
  size: number;
  file: {
    progress: Progress;
    refinedGroups: number;
    totalGroups: number;
    mistakes: number;
    status: FileStatus;
  };
}

export interface ClearanceCheck {
  name: 'DEPLOY' | 'SESSION' | 'GRID' | 'REFINE';
  passed: boolean;
  detail: string;
}

export interface ClearanceCheckResult {
  granted: boolean;
  grantedAt: string | null;
  checks: ClearanceCheck[];
}

export interface IntegrationStatus {
  deploy: {
    origin: string | null;
    verifiedAt: string | null;
    lastBuildSeen: string | null;
    lastBuildSeenAt: string | null;
  };
  storage: {
    provider: 'SUPABASE' | 'CLOUDINARY' | null;
    verifiedAt: string | null;
  };
  clearance: ClearanceStatus;
}

export interface ClearanceInfo {
  granted: boolean;
  grantedAt: string | null;
  checks: ClearanceCheck[];
  checkedAt: string | null;
  workspace: { kind: 'DEV' | 'EVAL'; chaosLevel: 0 | 1 | 2 };
}
