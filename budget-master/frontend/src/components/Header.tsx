import logo from '../assets/logo.png';

interface HeaderProps {
  uptime?: number;
}

export function Header({ uptime }: HeaderProps) {
  return (
    <header className="shrink-0 border-b border-gray-200 bg-white">
      <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-3 sm:px-6 lg:px-8">
        <img
          src={logo}
          alt="Budget Master"
          className="size-10 shrink-0 object-contain"
          width={40}
          height={40}
        />
        <div className="min-w-0 flex-1">
          <h1
            className="text-balance text-lg font-semibold tracking-tight text-gray-900 sm:text-xl"
            style={{ fontFamily: "'Cinzel', Georgia, 'Times New Roman', serif" }}
          >
            Budget Master
          </h1>
          {uptime != null && (
            <p className="text-xs text-gray-500 tabular-nums">
              System uptime: {Math.floor(uptime / 3600)}h {Math.floor((uptime % 3600) / 60)}m
            </p>
          )}
        </div>
      </div>
    </header>
  );
}
