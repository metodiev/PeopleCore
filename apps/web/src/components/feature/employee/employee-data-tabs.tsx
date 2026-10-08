import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { formatDate, formatMinutes, formatMoney } from '../../../lib/utils.js';
import type { Employee360 } from '../api-types.js';
import { DefinitionList, LockedSection, ProgressBar, SectionCard } from '../widgets.js';
import { BarPanel } from '../charts.js';
import { Badge, statusTone } from '../../ui/badge.js';
import { Card, CardHeader, CardTitle } from '../../ui/card.js';
import { EmptyState } from '../../ui/feedback.js';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../ui/table.js';

export function EmploymentTab({ data }: { data: Employee360 }) {
  const { t } = useTranslation();
  const contracts = data.employment?.contracts ?? [];
  return (
    <div className="space-y-4">
      <SectionCard title={t('employee.currentContract')}>
        {data.employment?.currentContract ? (
          <DefinitionList
            items={[
              { label: t('employee.contractType'), value: t(`contracts.type.${data.employment.currentContract.contractType}`, { defaultValue: data.employment.currentContract.contractType }) },
              { label: t('common.status'), value: <Badge tone={statusTone(data.employment.currentContract.status)}>{data.employment.currentContract.status}</Badge> },
              { label: t('employee.startDate'), value: formatDate(data.employment.currentContract.startDate) },
              { label: t('employee.endDate'), value: formatDate(data.employment.currentContract.endDate) },
              {
                label: t('employee.salary'),
                value: data.employment.currentContract.salaryAmount != null
                  ? formatMoney(data.employment.currentContract.salaryAmount, data.employment.currentContract.currency ?? 'EUR')
                  : t('common.none'),
              },
            ]}
          />
        ) : (
          <EmptyState title={t('employee.noContract')} />
        )}
      </SectionCard>
      <Card>
        <CardHeader>
          <CardTitle>{t('employee.contractHistory')}</CardTitle>
        </CardHeader>
        {contracts.length === 0 ? (
          <EmptyState title={t('employee.noContracts')} />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('employee.contractType')}</TableHead>
                <TableHead>{t('employee.startDate')}</TableHead>
                <TableHead>{t('employee.endDate')}</TableHead>
                <TableHead>{t('common.status')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {contracts.map((contract) => (
                <TableRow key={contract.id}>
                  <TableCell>{t(`contracts.type.${contract.contractType}`, { defaultValue: contract.contractType })}</TableCell>
                  <TableCell>{formatDate(contract.startDate)}</TableCell>
                  <TableCell>{formatDate(contract.endDate)}</TableCell>
                  <TableCell>
                    <Badge tone={statusTone(contract.status)}>{contract.status}</Badge>
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

export function OrganizationTab({ data }: { data: Employee360 }) {
  const { t } = useTranslation();
  const organization = data.organization;
  return (
    <div className="space-y-4">
      <SectionCard title={t('employee.organization')}>
        <DefinitionList
          items={[
            { label: t('people.department'), value: organization.department?.name ?? '—' },
            { label: t('people.team'), value: organization.team?.name ?? '—' },
            { label: t('people.location'), value: organization.location?.name ?? '—' },
            { label: t('people.position'), value: organization.position?.title ?? '—' },
            {
              label: t('people.manager'),
              value: organization.manager ? (
                <Link className="text-brand-600 hover:underline dark:text-brand-400" to={`/people/${organization.manager.id}`}>
                  {organization.manager.firstName} {organization.manager.lastName}
                </Link>
              ) : (
                '—'
              ),
            },
            {
              label: t('employee.schedule'),
              value: organization.schedule
                ? `${organization.schedule.name}${organization.schedule.startTime ? ` · ${organization.schedule.startTime}–${organization.schedule.endTime}` : ''}`
                : '—',
            },
          ]}
        />
      </SectionCard>
      <Card>
        <CardHeader>
          <CardTitle>{t('employee.history')}</CardTitle>
        </CardHeader>
        {(organization.history ?? []).length === 0 ? (
          <EmptyState title={t('employee.noHistory')} />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('employee.effectiveFrom')}</TableHead>
                <TableHead>{t('employee.changeType')}</TableHead>
                <TableHead>{t('common.details')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {organization.history.map((entry) => (
                <TableRow key={entry.id}>
                  <TableCell>{formatDate(entry.effectiveFrom)}</TableCell>
                  <TableCell>{entry.changeType ?? '—'}</TableCell>
                  <TableCell>{entry.notes ?? '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
    </div>
  );
}

export function LeaveTab({ data }: { data: Employee360 }) {
  const { t } = useTranslation();
  if (!data.leave) return <LockedSection message={t('employee.lockedLeave')} />;
  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {data.leave.balances.map((balance) => (
          <Card key={balance.leaveTypeId} className="p-4">
            <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">{balance.leaveType}</p>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              {t('leave.remainingDays', { count: balance.remaining })} · {t('leave.used')}: {balance.used} · {t('leave.pending')}: {balance.pending}
            </p>
            <div className="mt-3">
              <ProgressBar value={balance.used + balance.pending} max={Math.max(1, balance.available)} />
            </div>
          </Card>
        ))}
      </div>
      <Card>
        <CardHeader>
          <CardTitle>{t('leave.myRequests')}</CardTitle>
        </CardHeader>
        {data.leave.requests.length === 0 ? (
          <EmptyState title={t('leave.noRequests')} />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('leave.leaveType')}</TableHead>
                <TableHead>{t('leave.period')}</TableHead>
                <TableHead>{t('leave.days')}</TableHead>
                <TableHead>{t('common.status')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.leave.requests.map((request) => (
                <TableRow key={request.id}>
                  <TableCell>{request.leaveType?.name}</TableCell>
                  <TableCell>
                    {formatDate(request.startDate)} – {formatDate(request.endDate)}
                  </TableCell>
                  <TableCell>{request.daysRequested}</TableCell>
                  <TableCell>
                    <Badge tone={statusTone(request.status)}>{t(`leave.status.${request.status}`, { defaultValue: request.status })}</Badge>
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

export function AttendanceTab({ data }: { data: Employee360 }) {
  const { t } = useTranslation();
  if (!data.attendance) return <LockedSection message={t('employee.lockedAttendance')} />;
  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card className="p-4">
          <p className="text-xs uppercase text-slate-500">{t('attendance.daysTracked')}</p>
          <p className="mt-1 text-xl font-semibold">{data.attendance.summary.daysTracked}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs uppercase text-slate-500">{t('attendance.worked')}</p>
          <p className="mt-1 text-xl font-semibold">{formatMinutes(data.attendance.summary.totalWorkedMinutes)}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs uppercase text-slate-500">{t('attendance.overtime')}</p>
          <p className="mt-1 text-xl font-semibold">{formatMinutes(data.attendance.summary.totalOvertimeMinutes)}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs uppercase text-slate-500">{t('attendance.late')}</p>
          <p className="mt-1 text-xl font-semibold">{data.attendance.summary.lateDays}</p>
        </Card>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>{t('attendance.recentEntries')}</CardTitle>
        </CardHeader>
        {data.attendance.recent.length === 0 ? (
          <EmptyState title={t('attendance.noEntries')} />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('attendance.date')}</TableHead>
                <TableHead>{t('attendance.clockIn')}</TableHead>
                <TableHead>{t('attendance.clockOut')}</TableHead>
                <TableHead>{t('attendance.worked')}</TableHead>
                <TableHead>{t('common.status')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.attendance.recent.map((entry) => (
                <TableRow key={entry.id}>
                  <TableCell>{formatDate(entry.date)}</TableCell>
                  <TableCell>{entry.clockIn ? new Date(entry.clockIn).toLocaleTimeString() : '—'}</TableCell>
                  <TableCell>{entry.clockOut ? new Date(entry.clockOut).toLocaleTimeString() : '—'}</TableCell>
                  <TableCell>{formatMinutes(entry.workedMinutes ?? 0)}</TableCell>
                  <TableCell>
                    <Badge tone={statusTone(entry.status)}>{t(`attendance.status.${entry.status}`, { defaultValue: entry.status })}</Badge>
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

export function DocumentsTab({ data }: { data: Employee360 }) {
  const { t } = useTranslation();
  if (!data.documents) return <LockedSection message={t('employee.lockedDocuments')} />;
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('nav.documents')}</CardTitle>
      </CardHeader>
      {data.documents.length === 0 ? (
        <EmptyState title={t('documents.noDocuments')} />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('documents.name')}</TableHead>
              <TableHead>{t('documents.category')}</TableHead>
              <TableHead>{t('documents.expiresAt')}</TableHead>
              <TableHead>{t('documents.versions')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.documents.map((document) => (
              <TableRow key={document.id}>
                <TableCell>{document.name}</TableCell>
                <TableCell>{document.category?.name ?? '—'}</TableCell>
                <TableCell>{formatDate(document.expiresAt)}</TableCell>
                <TableCell>{document.versions}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Card>
  );
}

export function CompensationTab({ data }: { data: Employee360 }) {
  const { t } = useTranslation();
  if (!data.compensation || !data.permissions.salary) return <LockedSection message={t('employee.lockedCompensation')} />;
  const history = [...data.compensation.history].reverse();
  return (
    <div className="space-y-4">
      <SectionCard title={t('employee.currentCompensation')}>
        {data.compensation.current ? (
          <DefinitionList
            items={[
              { label: t('employee.amount'), value: formatMoney(data.compensation.current.amount, data.compensation.current.currency) },
              { label: t('employee.changeType'), value: data.compensation.current.changeType },
              { label: t('employee.effectiveDate'), value: formatDate(data.compensation.current.effectiveDate) },
              { label: t('leave.reason'), value: data.compensation.current.reason ?? '—' },
            ]}
          />
        ) : (
          <EmptyState title={t('employee.noCompensation')} />
        )}
      </SectionCard>
      <BarPanel
        title={t('employee.compensationHistory')}
        data={history.map((entry) => ({ label: formatDate(entry.effectiveDate), amount: Number(entry.amount) }))}
        xKey="label"
        series={[{ key: 'amount', name: t('employee.amount'), color: '#10b981' }]}
      />
      {data.benefits.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>{t('employee.benefits')}</CardTitle>
          </CardHeader>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('employee.benefitType')}</TableHead>
                <TableHead>{t('employee.startDate')}</TableHead>
                <TableHead>{t('employee.endDate')}</TableHead>
                <TableHead>{t('employee.amount')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.benefits.map((benefit) => (
                <TableRow key={benefit.id}>
                  <TableCell>{t(`benefits.type.${benefit.type}`, { defaultValue: benefit.type })}</TableCell>
                  <TableCell>{formatDate(benefit.startDate)}</TableCell>
                  <TableCell>{formatDate(benefit.endDate)}</TableCell>
                  <TableCell>{benefit.amount != null ? formatMoney(benefit.amount, benefit.currency ?? 'EUR') : '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      ) : null}
    </div>
  );
}
