const OPERATION_CONFIG = {
  COMPRA: {
    label: 'Compra',
    color: '#44ff44',
    bg: '#0a1a0a',
    icon: '🛒',
  },
  VENTA: {
    label: 'Venta',
    color: '#4488ff',
    bg: '#0a0a1a',
    icon: '💰',
  },
  NUEVO_PRODUCTO: {
    label: 'Nuevo Producto',
    color: '#aa44ff',
    bg: '#1a0a1a',
    icon: '📦',
  },
  AJUSTE: {
    label: 'Ajuste',
    color: '#ffaa00',
    bg: '#1a1a0a',
    icon: '🔧',
  },
  CONSULTA: {
    label: 'Consulta',
    color: '#888888',
    bg: '#1a1a1a',
    icon: '🔍',
  },
}

function OperationBadge({ operation }) {
  const config = OPERATION_CONFIG[operation] || OPERATION_CONFIG.CONSULTA

  return (
    <span
      className="operation-badge"
      style={{
        color: config.color,
        background: config.bg,
        border: `2px solid ${config.color}`,
        minWidth: '120px',
        justifyContent: 'center',
      }}
    >
      <span className="badge-icon">{config.icon}</span>
      {config.label}
    </span>
  )
}

export default OperationBadge
export { OPERATION_CONFIG }
