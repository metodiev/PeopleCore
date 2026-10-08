import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, X } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { z } from 'zod';
import { api, ApiError, type Paginated } from '../../../lib/api.js';
import { formatDate } from '../../../lib/utils.js';
import type { LeaveRequestItem } from '../api-types.js';
import { QueryBoundary } from '../query.js';
import { Badge, statusTone } from '../../ui/badge.js';
import { Button } from '../../ui/button.js';
import { Card } from '../../ui/card.js';
import { Dialog, DialogContent } from '../../ui/dialog.js';
import { EmptyState } from '../../ui/feedback.js';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../ui/table.js';
import { Field, Textarea } from '../../ui/input.js';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';

type Decision = 'approve' | 'reject';

function DecisionDialog(props: { request: LeaveRequestItem | null; decision: Decision; onClose: () => void }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const schema = z.object({
    comment: props.decision === 'reject' ? z.string().min(3, t('leave.rejectReasonRequired')).max(1000) : z.string().max(1000).optional(),
  });
  type FormValues = z.infer<typeof schema>;
  const form = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: { comment: '' } });

  const decide = useMutation({
    mutationFn: (values: FormValues) =>
      props.decision === 'approve'
        ? api.post(`/leave/requests/${props.request?.id}/approve`, { comment: values.comment || undefined })
        : api.post(`/leave/requests/${props.request?.id}/reject`, { comment: values.comment || undefined }),
    onSuccess: () => {
      toast.success(props.decision === 'approve' ? t('leave.approved') : t('leave.rejected'));
      void queryClient.invalidateQueries({ queryKey: ['leave'] });
      props.onClose();
    },
    onError: (error) => toast.error(error instanceof ApiError ? error.message : t('common.error')),
  });

  return (
    <Dialog open={props.request !== null} onOpenChange={(open) => (open ? undefined : props.onClose())}>
      <DialogContent
        title={props.decision === 'approve' ? t('leave.approveRequest') : t('leave.rejectRequest')}
        description={
          props.request
            ? `${props.request.employee?.firstName ?? ''} ${props.request.employee?.lastName ?? ''} · ${props.request.leaveType?.name ?? ''} · ${formatDate(props.request.startDate)} – ${formatDate(props.request.endDate)}`
            : undefined
        }
      >
        <form
          className="space-y-4"
          noValidate
          onSubmit={form.handleSubmit((values) => decide.mutate(values))}
        >
          <Field label={t('leave.comment')} htmlFor="decision-comment" error={form.formState.errors.comment?.message}>
            <Textarea id="decision-comment" rows={3} {...form.register('comment')} />
          </Field>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={props.onClose}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" variant={props.decision === 'reject' ? 'danger' : 'primary'} loading={decide.isPending}>
              {props.decision === 'approve' ? t('leave.approve') : t('leave.reject')}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function LeaveApprovalsTab() {
  const { t } = useTranslation();
  const [selection, setSelection] = useState<{ request: LeaveRequestItem; decision: Decision } | null>(null);

  const pending = useQuery({
    queryKey: ['leave', 'pending-approval'],
    queryFn: () => api.get<Paginated<LeaveRequestItem>>('/leave/requests/pending-approval', { query: { pageSize: 50 } }),
  });

  return (
    <>
      <Card>
        <QueryBoundary
          query={pending}
          isEmpty={(data) => data.data.length === 0}
          empty={<EmptyState title={t('leave.noPendingApprovals')} description={t('leave.noPendingApprovalsHint')} />}
        >
          {(data) => (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('people.name')}</TableHead>
                  <TableHead>{t('leave.leaveType')}</TableHead>
                  <TableHead>{t('leave.period')}</TableHead>
                  <TableHead>{t('leave.days')}</TableHead>
                  <TableHead>{t('common.status')}</TableHead>
                  <TableHead className="text-right">{t('common.actions')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.data.map((request) => (
                  <TableRow key={request.id}>
                    <TableCell>
                      {request.employee?.firstName} {request.employee?.lastName}
                    </TableCell>
                    <TableCell>
                      <span className="inline-flex items-center gap-2">
                        <span className="size-2 rounded-full" style={{ backgroundColor: request.leaveType?.color ?? '#94a3b8' }} aria-hidden />
                        {request.leaveType?.name}
                      </span>
                    </TableCell>
                    <TableCell>
                      {formatDate(request.startDate)} – {formatDate(request.endDate)}
                    </TableCell>
                    <TableCell>{request.daysRequested}</TableCell>
                    <TableCell>
                      <Badge tone={statusTone(request.status)}>{t(`leave.status.${request.status}`, { defaultValue: request.status })}</Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-2">
                        <Button size="sm" variant="outline" onClick={() => setSelection({ request, decision: 'approve' })}>
                          <Check className="size-3.5" aria-hidden />
                          {t('leave.approve')}
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => setSelection({ request, decision: 'reject' })}>
                          <X className="size-3.5" aria-hidden />
                          {t('leave.reject')}
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </QueryBoundary>
      </Card>
      <DecisionDialog
        request={selection?.request ?? null}
        decision={selection?.decision ?? 'approve'}
        onClose={() => setSelection(null)}
      />
    </>
  );
}
