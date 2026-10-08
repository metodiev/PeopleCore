import { useTranslation } from 'react-i18next';
import { formatDate, formatMoney } from '../../../lib/utils.js';
import type { Employee360 } from '../api-types.js';
import { LockedSection, ProgressBar } from '../widgets.js';
import { Badge, statusTone } from '../../ui/badge.js';
import { Card, CardContent, CardHeader, CardTitle } from '../../ui/card.js';
import { EmptyState } from '../../ui/feedback.js';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../ui/table.js';

export function PerformanceTab({ data }: { data: Employee360 }) {
  const { t } = useTranslation();
  if (!data.performance) return <LockedSection message={t('employee.lockedPerformance')} />;
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>{t('performance.reviews')}</CardTitle>
        </CardHeader>
        {data.performance.length === 0 ? (
          <EmptyState title={t('performance.noReviews')} />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('performance.cycle')}</TableHead>
                <TableHead>{t('performance.reviewTypeLabel')}</TableHead>
                <TableHead>{t('performance.rating')}</TableHead>
                <TableHead>{t('common.status')}</TableHead>
                <TableHead>{t('performance.submittedAt')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.performance.map((review) => (
                <TableRow key={review.id}>
                  <TableCell>{review.cycle?.name ?? '—'}</TableCell>
                  <TableCell>{t(`performance.type.${review.type}`, { defaultValue: review.type })}</TableCell>
                  <TableCell>{review.overallRating ?? '—'}</TableCell>
                  <TableCell>
                    <Badge tone={statusTone(review.status)}>{t(`performance.status.${review.status}`, { defaultValue: review.status })}</Badge>
                  </TableCell>
                  <TableCell>{formatDate(review.submittedAt)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>{t('performance.goals')}</CardTitle>
        </CardHeader>
        {(data.goals ?? []).length === 0 ? (
          <EmptyState title={t('performance.noGoals')} />
        ) : (
          <CardContent className="space-y-4">
            {(data.goals ?? []).map((goal) => (
              <div key={goal.id}>
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span className="font-medium text-slate-900 dark:text-slate-100">{goal.title}</span>
                  <span className="text-xs text-slate-500">
                    {goal.progress}% · {formatDate(goal.dueDate)}
                  </span>
                </div>
                <div className="mt-1">
                  <ProgressBar value={goal.progress} tone={goal.status === 'AT_RISK' || goal.status === 'OFF_TRACK' ? 'danger' : 'brand'} />
                </div>
                {(goal.keyResults ?? []).length > 0 ? (
                  <ul className="mt-2 space-y-1 text-xs text-slate-500 dark:text-slate-400">
                    {(goal.keyResults ?? []).map((result) => (
                      <li key={result.id}>
                        {result.title}: {result.currentValue}/{result.targetValue} {result.unit ?? ''}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ))}
          </CardContent>
        )}
      </Card>
    </div>
  );
}

export function TrainingTab({ data }: { data: Employee360 }) {
  const { t } = useTranslation();
  if (!data.training) return <LockedSection message={t('employee.lockedTraining')} />;
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>{t('training.assignments')}</CardTitle>
        </CardHeader>
        {data.training.length === 0 ? (
          <EmptyState title={t('training.noAssignments')} />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('training.course')}</TableHead>
                <TableHead>{t('training.dueDate')}</TableHead>
                <TableHead>{t('training.score')}</TableHead>
                <TableHead>{t('common.status')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.training.map((assignment) => (
                <TableRow key={assignment.id}>
                  <TableCell>{assignment.course?.title ?? '—'}</TableCell>
                  <TableCell>{formatDate(assignment.dueDate)}</TableCell>
                  <TableCell>{assignment.score ?? '—'}</TableCell>
                  <TableCell>
                    <Badge tone={statusTone(assignment.status)}>{t(`training.status.${assignment.status}`, { defaultValue: assignment.status })}</Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>{t('training.certifications')}</CardTitle>
        </CardHeader>
        {(data.certifications ?? []).length === 0 ? (
          <EmptyState title={t('training.noCertifications')} />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('training.name')}</TableHead>
                <TableHead>{t('training.issuer')}</TableHead>
                <TableHead>{t('training.issuedDate')}</TableHead>
                <TableHead>{t('training.expiresAt')}</TableHead>
                <TableHead>{t('common.status')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(data.certifications ?? []).map((certification) => (
                <TableRow key={certification.id}>
                  <TableCell>{certification.name}</TableCell>
                  <TableCell>{certification.issuer ?? '—'}</TableCell>
                  <TableCell>{formatDate(certification.issuedDate)}</TableCell>
                  <TableCell>{formatDate(certification.expiresAt)}</TableCell>
                  <TableCell>
                    <Badge tone={statusTone(certification.status)}>{t(`training.certificationStatus.${certification.status}`, { defaultValue: certification.status })}</Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
    </div>
  );
}

export function AssetsTab({ data }: { data: Employee360 }) {
  const { t } = useTranslation();
  if (!data.assets) return <LockedSection message={t('employee.lockedAssets')} />;
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('assets.assigned')}</CardTitle>
      </CardHeader>
      {data.assets.length === 0 ? (
        <EmptyState title={t('assets.noneAssigned')} />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('assets.name')}</TableHead>
              <TableHead>{t('assets.categoryLabel')}</TableHead>
              <TableHead>{t('assets.serialNumber')}</TableHead>
              <TableHead>{t('assets.conditionLabel')}</TableHead>
              <TableHead>{t('common.status')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.assets.map((asset) => (
              <TableRow key={asset.id}>
                <TableCell>{asset.name}</TableCell>
                <TableCell>{t(`assets.category.${asset.category}`, { defaultValue: asset.category })}</TableCell>
                <TableCell>{asset.serialNumber ?? '—'}</TableCell>
                <TableCell>{t(`assets.condition.${asset.condition}`, { defaultValue: asset.condition })}</TableCell>
                <TableCell>
                  <Badge tone={statusTone(asset.status)}>{t(`assets.status.${asset.status}`, { defaultValue: asset.status })}</Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Card>
  );
}

export function ExpensesTab({ data }: { data: Employee360 }) {
  const { t } = useTranslation();
  if (!data.expenses) return <LockedSection message={t('employee.lockedExpenses')} />;
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('expenses.title')}</CardTitle>
      </CardHeader>
      {data.expenses.length === 0 ? (
        <EmptyState title={t('expenses.noExpenses')} />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('expenses.titleField')}</TableHead>
              <TableHead>{t('expenses.category')}</TableHead>
              <TableHead>{t('expenses.date')}</TableHead>
              <TableHead>{t('expenses.amount')}</TableHead>
              <TableHead>{t('common.status')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.expenses.map((expense) => (
              <TableRow key={expense.id}>
                <TableCell>{expense.title}</TableCell>
                <TableCell>{expense.category?.name ?? '—'}</TableCell>
                <TableCell>{formatDate(expense.expenseDate)}</TableCell>
                <TableCell>{formatMoney(expense.amount, expense.currency)}</TableCell>
                <TableCell>
                  <Badge tone={statusTone(expense.status)}>{t(`expenses.status.${expense.status}`, { defaultValue: expense.status })}</Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Card>
  );
}

export function RequestsTab({ data }: { data: Employee360 }) {
  const { t } = useTranslation();
  if (!data.requests) return <LockedSection message={t('employee.lockedRequests')} />;
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('requests.title')}</CardTitle>
      </CardHeader>
      {data.requests.length === 0 ? (
        <EmptyState title={t('requests.noRequests')} />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('requests.subject')}</TableHead>
              <TableHead>{t('requests.type')}</TableHead>
              <TableHead>{t('requests.priority')}</TableHead>
              <TableHead>{t('common.status')}</TableHead>
              <TableHead>{t('requests.createdAt')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.requests.map((request) => (
              <TableRow key={request.id}>
                <TableCell>{request.subject}</TableCell>
                <TableCell>{t(`requests.typeValue.${request.type}`, { defaultValue: request.type })}</TableCell>
                <TableCell>{t(`requests.priorityValue.${request.priority}`, { defaultValue: request.priority })}</TableCell>
                <TableCell>
                  <Badge tone={statusTone(request.status)}>{t(`requests.status.${request.status}`, { defaultValue: request.status })}</Badge>
                </TableCell>
                <TableCell>{formatDate(request.createdAt)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Card>
  );
}

export function ActivityTab({ data }: { data: Employee360 }) {
  const { t } = useTranslation();
  if (!data.activity || !data.permissions.audit) return <LockedSection message={t('employee.lockedActivity')} />;
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('settings.audit')}</CardTitle>
      </CardHeader>
      {data.activity.length === 0 ? (
        <EmptyState title={t('audit.noEntries')} />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('audit.action')}</TableHead>
              <TableHead>{t('audit.entity')}</TableHead>
              <TableHead>{t('audit.date')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.activity.map((entry) => (
              <TableRow key={entry.id}>
                <TableCell>{entry.action}</TableCell>
                <TableCell>
                  {entry.entityType}
                  {entry.entityId ? <span className="block font-mono text-xs text-slate-500">{entry.entityId}</span> : null}
                </TableCell>
                <TableCell>{formatDate(entry.createdAt)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Card>
  );
}
