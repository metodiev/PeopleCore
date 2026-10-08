import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Plus, X } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { api, ApiError, type Paginated } from '../../../lib/api.js';
import { formatDate } from '../../../lib/utils.js';
import { useAuth } from '../../../store/auth.js';
import type { AttendanceCorrectionItem, EmployeeListItem } from '../api-types.js';
import { QueryBoundary } from '../query.js';
import { Badge, statusTone } from '../../ui/badge.js';
import { Button } from '../../ui/button.js';
import { Card } from '../../ui/card.js';
import { ConfirmDialog } from '../../ui/dialog.js';
import { EmptyState } from '../../ui/feedback.js';
import { Select } from '../../ui/input.js';
import { Pagination } from '../../ui/misc.js';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../ui/table.js';
import { CorrectionDialog, type CorrectionValues } from './correction-dialog.js';

const STATUS_FILTERS = ['PENDING', 'APPROVED', 'REJECTED'] as const;

export function CorrectionsTab() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const canApprove = useAuth((state) => state.can('attendance.approve'));
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [employeeId, setEmployeeId] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [decision, setDecision] = useState<{ correction: AttendanceCorrectionItem; action: 'approve' | 'reject' } | null>(null);

  const employees = useQuery({
    queryKey: ['employees', 'options'],
    queryFn: () => api.get<Paginated<EmployeeListItem>>('/employees', { query: { pageSize: 100 } }),
    staleTime: 5 * 60_000,
  });

  const corrections = useQuery({
    queryKey: ['attendance', 'corrections', { page, status, employeeId }],
    queryFn: () =>
      api.get<Paginated<AttendanceCorrectionItem>>('/attendance/corrections', {
        query: { page, pageSize: 10, status: status || undefined, employeeId: employeeId || undefined },
      }),
  });

  const create = useMutation({
    mutationFn: (values: CorrectionValues) => api.post('/attendance/corrections', { ...values, employeeId: employeeId || undefined }),
    onSuccess: () => {
      toast.success(t('common.created'));
      void queryClient.invalidateQueries({ queryKey: ['attendance', 'corrections'] });
    },
  });

  const decide = useMutation({
    mutationFn: (payload: { correction: AttendanceCorrectionItem; action: 'approve' | 'reject' }) =>
      payload.action === 'approve'
        ? api.post(`/attendance/corrections/${payload.correction.id}/approve`, {})
        : api.post(`/attendance/corrections/${payload.correction.id}/reject`, {}),
    onSuccess: () => {
      toast.success(t('common.saved'));
      void queryClient.invalidateQueries({ queryKey: ['attendance'] });
      setDecision(null);
    },
    onError: (error) => toast.error(error instanceof ApiError ? error.message : t('common.error')),
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <Select
            aria-label={t('common.status')}
            className="sm:w-44"
            value={status}
            onChange={(event) => {
              setStatus(event.target.value);
              setPage(1);
            }}
          >
            <option value="">{t('common.all')}</option>
            {STATUS_FILTERS.map((value) => (
              <option key={value} value={value}>
                {t(`attendance.correctionStatus.${value}`)}
              </option>
            ))}
          </Select>
          <Select
            aria-label={t('attendance.employee')}
            className="sm:w-64"
            value={employeeId}
            onChange={(event) => {
              setEmployeeId(event.target.value);
              setPage(1);
            }}
          >
            <option value="">{t('attendance.allEmployees')}</option>
            {(employees.data?.data ?? []).map((employee) => (
              <option key={employee.id} value={employee.id}>
                {employee.firstName} {employee.lastName}
              </option>
            ))}
          </Select>
        </div>
        <Button onClick={() => setDialogOpen(true)}>
          <Plus className="size-4" aria-hidden />
          {t('attendance.requestCorrection')}
        </Button>
      </div>

      <Card>
        <QueryBoundary
          query={corrections}
          isEmpty={(data) => data.data.length === 0}
          empty={<EmptyState title={t('attendance.noCorrections')} description={t('attendance.noCorrectionsHint')} />}
        >
          {(data) => (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('attendance.employee')}</TableHead>
                    <TableHead>{t('attendance.date')}</TableHead>
                    <TableHead>{t('attendance.requestedChange')}</TableHead>
                    <TableHead>{t('attendance.reason')}</TableHead>
                    <TableHead>{t('common.status')}</TableHead>
                    {canApprove ? <TableHead className="text-right">{t('common.actions')}</TableHead> : null}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.data.map((correction) => (
                    <TableRow key={correction.id}>
                      <TableCell>{correction.employee?.name ?? '—'}</TableCell>
                      <TableCell>{formatDate(correction.date)}</TableCell>
                      <TableCell className="text-xs">
                        {correction.requestedClockIn ? (
                          <span className="block">
                            {t('attendance.newClockIn')}: {new Date(correction.requestedClockIn).toLocaleTimeString()}
                          </span>
                        ) : null}
                        {correction.requestedClockOut ? (
                          <span className="block">
                            {t('attendance.newClockOut')}: {new Date(correction.requestedClockOut).toLocaleTimeString()}
                          </span>
                        ) : null}
                        {correction.requestedStatus ? (
                          <span className="block">
                            {t('common.status')}: {t(`attendance.status.${correction.requestedStatus}`, { defaultValue: correction.requestedStatus })}
                          </span>
                        ) : null}
                      </TableCell>
                      <TableCell className="max-w-xs truncate" title={correction.reason}>
                        {correction.reason}
                      </TableCell>
                      <TableCell>
                        <Badge tone={statusTone(correction.status)}>{t(`attendance.correctionStatus.${correction.status}`, { defaultValue: correction.status })}</Badge>
                      </TableCell>
                      {canApprove ? (
                        <TableCell>
                          {correction.status === 'PENDING' ? (
                            <div className="flex justify-end gap-2">
                              <Button size="sm" variant="outline" onClick={() => setDecision({ correction, action: 'approve' })}>
                                <Check className="size-3.5" aria-hidden />
                                {t('leave.approve')}
                              </Button>
                              <Button size="sm" variant="outline" onClick={() => setDecision({ correction, action: 'reject' })}>
                                <X className="size-3.5" aria-hidden />
                                {t('leave.reject')}
                              </Button>
                            </div>
                          ) : (
                            '—'
                          )}
                        </TableCell>
                      ) : null}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <Pagination page={data.meta.page} totalPages={data.meta.totalPages} total={data.meta.total} onPageChange={setPage} />
            </>
          )}
        </QueryBoundary>
      </Card>

      <CorrectionDialog open={dialogOpen} onOpenChange={setDialogOpen} onSubmit={(values) => create.mutateAsync(values)} />
      <ConfirmDialog
        open={decision !== null}
        onOpenChange={(open) => (open ? undefined : setDecision(null))}
        title={decision?.action === 'approve' ? t('attendance.approveCorrection') : t('attendance.rejectCorrection')}
        description={decision ? `${decision.correction.employee?.name ?? ''} · ${formatDate(decision.correction.date)}` : undefined}
        destructive={decision?.action === 'reject'}
        loading={decide.isPending}
        onConfirm={() => (decision ? decide.mutate(decision) : undefined)}
      />
    </div>
  );
}
