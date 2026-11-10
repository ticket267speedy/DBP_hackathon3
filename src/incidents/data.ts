export const severityLabels = { LOW: 'Baja', MEDIUM: 'Media', HIGH: 'Alta', CRITICAL: 'Crítica' };
export type Severity = keyof typeof severityLabels;

export interface Incident {
  id: number;
  title: string;
  description: string;
  severity: Severity;
  fileId: number | null;
  file: { id: number; name: string } | null;
  photos: { mediaId: number; url: string; width: number; height: number }[];
  createdBy: { id: number; displayName: string };
  createdAt: string;
}
