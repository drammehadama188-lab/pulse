import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { team } from '../data/team';

// Slim employee profile — just the person's CURRENT information (role, status,
// contract start/end dates, pay). Performance, coaching, reviews and team
// command now live on their own dedicated pages, so this page no longer tries
// to be a full dashboard. (24 Jun 2026, Adama's request.)

function formatDate(d) {
  if (!d) return '—';
  const date = new Date(d);
  if (isNaN(date)) return d;
  return date.toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' });
}

function Detail({ label, value, accent }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider font-bold text-gray-400 mb-1">{label}</p>
      <p className={`text-sm font-medium ${accent || 'text-gray-900'}`}>{value}</p>
    </div>
  );
}

export default function EmployeeProfile() {
  const { slug } = useParams();
  const navigate = useNavigate();
  const agent = team.find((t) => t.name.toLowerCase().replace(/\s+/g, '-') === slug);

  if (!agent) {
    return (
      <div>
        <button onClick={() => navigate(-1)} className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-900 mb-6"><ArrowLeft size={14} /> Back</button>
        <div className="bg-white rounded-2xl border border-gray-100 p-10 text-center text-gray-400">Employee not found.</div>
      </div>
    );
  }

  const initials = agent.name.split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
  const now = new Date();
  const daysToEnd = agent.contractEnd ? Math.ceil((new Date(agent.contractEnd) - now) / 86400000) : null;
  const isActive = agent.status ? agent.status === 'active' : (!agent.contractEnd || new Date(agent.contractEnd) > now);
  const statusLabel = agent.status ? agent.status.charAt(0).toUpperCase() + agent.status.slice(1) : (isActive ? 'Active' : 'Expired');
  const statusColor = isActive ? 'bg-emerald-100 text-emerald-700'
    : agent.status === 'training' ? 'bg-orange-100 text-orange-700'
    : agent.status === 'probation' ? 'bg-amber-100 text-amber-700'
    : 'bg-red-100 text-red-700';
  const warnings = agent.warnings || 0;

  return (
    <div className="max-w-3xl">
      <button onClick={() => navigate(-1)} className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-900 mb-6"><ArrowLeft size={14} /> Back</button>

      {/* Identity */}
      <div className="bg-white rounded-3xl border border-gray-100 p-6 mb-4">
        <div className="flex items-start gap-5">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-emerald-500 to-emerald-700 flex items-center justify-center text-white text-lg font-semibold shrink-0">
            {initials}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3 mb-1 flex-wrap">
              <h1 className="text-2xl font-semibold text-gray-900">{agent.name}</h1>
              <span className={`px-2.5 py-1 rounded-full text-[11px] font-semibold ${statusColor}`}>{statusLabel}</span>
            </div>
            <p className="text-gray-600">{agent.role}</p>
            {agent.type && <p className="text-[11px] text-gray-400 mt-1">{agent.type}</p>}
          </div>
        </div>
      </div>

      {/* Current information */}
      <div className="bg-white rounded-3xl border border-gray-100 p-6">
        <h2 className="text-base font-semibold text-gray-900 mb-5">Current information</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-5">
          <Detail label="Role" value={agent.role || '—'} />
          <Detail label="Department" value={agent.type || '—'} />
          <Detail label="Status" value={statusLabel} accent={isActive ? 'text-emerald-700' : 'text-gray-900'} />
          <Detail label="Start date" value={agent.joined || '—'} />
          <Detail label="Contract" value={agent.contract || '—'} />
          <Detail
            label="End date"
            value={
              <>
                {agent.contractEnd ? formatDate(agent.contractEnd) : '—'}
                {daysToEnd !== null && daysToEnd > 0 && <span className="text-gray-400 font-normal ml-1">({daysToEnd}d)</span>}
                {daysToEnd !== null && daysToEnd <= 0 && <span className="text-red-500 font-normal ml-1">(expired)</span>}
              </>
            }
            accent={daysToEnd !== null && daysToEnd <= 30 ? 'text-red-600' : daysToEnd !== null && daysToEnd <= 90 ? 'text-amber-600' : 'text-gray-900'}
          />
          <Detail label="Base salary" value={`D${(agent.base || 0).toLocaleString()}`} />
          <Detail label="Commission" value={agent.commission > 0 ? `Up to D${agent.commission.toLocaleString()}` : '—'} accent={agent.commission > 0 ? 'text-emerald-700' : 'text-gray-900'} />
          <Detail label="Warnings" value={String(warnings)} accent={warnings > 0 ? 'text-red-600' : 'text-gray-900'} />
        </div>
      </div>
    </div>
  );
}
