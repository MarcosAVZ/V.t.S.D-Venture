import { useState, useCallback, useMemo, useEffect } from 'react'
import OperationBadge from './OperationBadge'

const OPERATION_FIELDS = {
  COMPRA: {
    fields: ['fecha', 'proveedor', 'metodo_pago'],
    hasProducts: true,
    productFields: ['nombre', 'color', 'talle', 'cantidad', 'precio_unitario'],
    label: 'Nueva compra',
  },
  VENTA: {
    fields: ['fecha', 'cliente', 'metodo_pago'],
    hasProducts: true,
    productFields: ['nombre', 'cantidad', 'precio_unitario', 'color', 'talle'],
    label: 'Nueva venta',
  },
  NUEVO_PRODUCTO: {
    fields: ['producto', 'precio', 'precio_venta', 'stock_inicial'],
    hasProducts: false,
    label: 'Nuevo producto',
  },
  AJUSTE: {
    fields: ['producto', 'color', 'talle', 'cantidad', 'motivo'],
    hasProducts: false,
    label: 'Ajuste de stock',
  },
  CONSULTA: {
    fields: ['producto', 'color', 'talle'],
    hasProducts: false,
    label: 'Consulta de stock',
  },
}

const FIELD_LABELS = {
  fecha: 'Fecha',
  proveedor: 'Proveedor',
  cliente: 'Cliente',
  metodo_pago: 'Método de pago',
  producto: 'Producto',
  color: 'Color',
  talle: 'Talle',
  precio: 'Precio compra',
  precio_venta: 'Precio venta',
  stock_inicial: 'Stock inicial',
  cantidad: 'Cantidad',
  motivo: 'Motivo',
  nombre: 'Nombre',
  precio_unitario: 'Precio unitario',
}

function EditableField({ label, value, onChange, type = 'text', placeholder, required = false, missing = false, disabled = false, suffix }) {
  return (
    <div className={`confirmation-field ${missing ? 'field-missing' : ''}`}>
      <label className="field-label">{label}{required && ' *'}</label>
      <div className="field-input-wrapper">
        {type === 'number' ? (
          <input
            type="number"
            className="field-input"
            value={value ?? ''}
            onChange={(e) => onChange(parseFloat(e.target.value) || null)}
            placeholder={placeholder}
            min="0"
            step="any"
            disabled={disabled}
          />
        ) : (
          <input
            type="text"
            className="field-input"
            value={value ?? ''}
            onChange={(e) => onChange(e.target.value || null)}
            placeholder={placeholder}
            disabled={disabled}
          />
        )}
        {suffix && <span className="field-suffix">{suffix}</span>}
      </div>
    </div>
  )
}

function ConfirmationScreen({ operation, data, transcription, onConfirm, onCancel, isExecuting }) {
  const [editData, setEditData] = useState(() => JSON.parse(JSON.stringify(data)))
  const [overrideOperation, setOverrideOperation] = useState(operation)
  const [isEditing, setIsEditing] = useState(false)
  const [currentStock, setCurrentStock] = useState(null)
  const [stockLoading, setStockLoading] = useState(false)

  const config = OPERATION_FIELDS[overrideOperation] || OPERATION_FIELDS.COMPRA

  // Fetch current stock when component mounts or product changes
  useEffect(() => {
    const productName = editData.producto || editData.productos?.[0]?.nombre
    if (!productName || overrideOperation === 'NUEVO_PRODUCTO') {
      setCurrentStock(overrideOperation === 'NUEVO_PRODUCTO' ? 0 : null)
      return
    }

    setStockLoading(true)
    fetch(`/api/inventory/stock?producto=${encodeURIComponent(productName)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((result) => {
        if (result?.success) {
          setCurrentStock(result.stock)
        } else {
          setCurrentStock(null)
        }
      })
      .catch(() => setCurrentStock(null))
      .finally(() => setStockLoading(false))
  }, [editData.producto, editData.productos?.[0]?.nombre, overrideOperation])

  const updateField = useCallback((field, value) => {
    setEditData((prev) => ({ ...prev, [field]: value }))
  }, [])

  const updateProductField = useCallback((index, field, value) => {
    setEditData((prev) => {
      const newProductos = [...(prev.productos || [])]
      newProductos[index] = { ...newProductos[index], [field]: value }
      return { ...prev, productos: newProductos }
    })
  }, [])

  const addProduct = useCallback(() => {
    setEditData((prev) => ({
      ...prev,
      productos: [
        ...(prev.productos || []),
        { nombre: '', cantidad: 1, precio_unitario: null, color: null, talle: null },
      ],
    }))
  }, [])

  const removeProduct = useCallback((index) => {
    setEditData((prev) => ({
      ...prev,
      productos: prev.productos.filter((_, i) => i !== index),
    }))
  }, [])

  const total = useMemo(() => {
    if (!editData.productos) return null
    return editData.productos.reduce((sum, p) => {
      const qty = p.cantidad || 0
      const price = p.precio_unitario || 0
      return sum + qty * price
    }, 0)
  }, [editData.productos])

  const missingRequired = useMemo(() => {
    const missing = []
    config.fields.forEach((field) => {
      if (editData[field] === null || editData[field] === undefined || editData[field] === '') {
        missing.push(field)
      }
    })
    return missing
  }, [config.fields, editData])

  const handleConfirm = useCallback(() => {
    onConfirm({
      operation: overrideOperation,
      data: editData,
    })
  }, [overrideOperation, editData, onConfirm])

  const handleOperationChange = useCallback((e) => {
    const newOp = e.target.value
    setOverrideOperation(newOp)
  }, [])

  return (
    <div className="confirmation-screen">
      <div className="confirmation-header">
        <OperationBadge operation={overrideOperation} />
        <h2>{config.label}</h2>
      </div>

      {transcription && (
        <div className="confirmation-transcription">
          <span className="transcription-label">Transcripción:</span>
          <span className="transcription-text">{transcription}</span>
        </div>
      )}

      {overrideOperation !== 'NUEVO_PRODUCTO' && (
        <div className="stock-display">
          <span className="stock-label">Stock actual:</span>
          {stockLoading ? (
            <span className="stock-loading">Cargando...</span>
          ) : currentStock !== null ? (
            <span className={`stock-value ${currentStock === 0 ? 'stock-empty' : ''}`}>
              {currentStock} unidades
            </span>
          ) : (
            <span className="stock-na">No encontrado</span>
          )}
        </div>
      )}

      {overrideOperation === 'NUEVO_PRODUCTO' && (
        <div className="stock-display">
          <span className="stock-label">Stock actual:</span>
          <span className="stock-value">0 unidades (nuevo producto)</span>
        </div>
      )}

      <div className="confirmation-fields">
        {config.fields.map((field) => (
          <EditableField
            key={field}
            label={FIELD_LABELS[field]}
            value={editData[field]}
            onChange={(val) => updateField(field, val)}
            type={field === 'precio' || field === 'precio_venta' || field === 'stock_inicial' ? 'number' : 'text'}
            required={field === 'fecha' || field === 'producto'}
            missing={isEditing && missingRequired.includes(field)}
            placeholder={field === 'fecha' ? 'DD/MM/AAAA' : ''}
            disabled={isExecuting}
            suffix={(field === 'precio' || field === 'precio_venta') && overrideOperation === 'NUEVO_PRODUCTO' ? '/ unidad' : null}
          />
        ))}
      </div>

      {config.hasProducts && editData.productos && (
        <div className="confirmation-products">
          <div className="products-header">
            <h3>Productos ({editData.productos.length})</h3>
            {isEditing && !isExecuting && (
              <button className="add-product-btn" onClick={addProduct}>
                + Agregar
              </button>
            )}
          </div>

          {editData.productos.map((producto, index) => (
            <div key={index} className="product-edit-card">
              <div className="product-edit-header">
                <span className="product-index">#{index + 1}</span>
                {isEditing && editData.productos.length > 1 && !isExecuting && (
                  <button
                    className="remove-product-btn"
                    onClick={() => removeProduct(index)}
                  >
                    ✕
                  </button>
                )}
              </div>

              <div className="product-edit-fields">
                {config.productFields.map((field) => (
                  <EditableField
                    key={field}
                    label={FIELD_LABELS[field]}
                    value={producto[field]}
                    onChange={(val) => updateProductField(index, field, val)}
                    type={field === 'cantidad' || field === 'precio_unitario' ? 'number' : 'text'}
                    disabled={isExecuting}
                  />
                ))}
              </div>

              {producto.cantidad && producto.precio_unitario && (
                <div className="product-total">
                  Subtotal: ${(producto.cantidad * producto.precio_unitario).toLocaleString('es-AR')}
                </div>
              )}
            </div>
          ))}

          {total !== null && total > 0 && (
            <div className="products-total">
              Total: ${total.toLocaleString('es-AR')}
            </div>
          )}
        </div>
      )}

      <div className="confirmation-override">
        <label className="override-label">Operación:</label>
        <select
          className="override-select"
          value={overrideOperation}
          onChange={handleOperationChange}
          disabled={isExecuting}
        >
          <option value="COMPRA">Compra</option>
          <option value="VENTA">Venta</option>
          <option value="NUEVO_PRODUCTO">Nuevo Producto</option>
          <option value="AJUSTE">Ajuste</option>
          <option value="CONSULTA">Consulta</option>
        </select>
      </div>

      <div className="confirmation-actions">
        <button
          className="action-btn edit-btn"
          onClick={() => setIsEditing(!isEditing)}
          disabled={isExecuting}
        >
          {isEditing ? '🔒 Cerrar edición' : '✏️ Editar'}
        </button>

        <button
          className="action-btn cancel-btn"
          onClick={onCancel}
          disabled={isExecuting}
        >
          Cancelar
        </button>

        <button
          className="action-btn confirm-btn"
          onClick={handleConfirm}
          disabled={isExecuting || (isEditing && missingRequired.length > 0)}
        >
          {isExecuting ? (
            <span className="btn-loading">
              <span className="btn-spinner"></span>
              Guardando...
            </span>
          ) : (
            '✓ Confirmar'
          )}
        </button>
      </div>
    </div>
  )
}

export default ConfirmationScreen
