import { describe, it, expect, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import PurchaseItemsTable from './PurchaseItemsTable'

const row = (over = {}) => ({
  id: 'a', nombre: 'Gorra gato', variante: 'rosa', titulo_corto: 'Gorra de béisbol con gato bordado muy larga',
  cantidad: '2', unidades_por_paquete: '1', costo_paquete: '6762', precio_venta: '', ...over,
})

const setup = (props = {}) => {
  const onChange = vi.fn()
  const onDelete = vi.fn()
  const rows = props.rows ?? [row()]
  const matches = props.matches ?? { 'gorra gato': { status: 'existe' } }
  render(<PurchaseItemsTable rows={rows} matches={matches} rowErrors={props.rowErrors ?? {}} onChange={onChange} onDelete={onDelete} />)
  return { onChange, onDelete }
}

describe('PurchaseItemsTable', () => {
  it('muestra campos etiquetados con los valores de la fila y el titulo original', () => {
    setup()
    expect(screen.getByLabelText('Nombre (fila 1)')).toHaveValue('Gorra gato')
    expect(screen.getByLabelText('Variante (fila 1)')).toHaveValue('rosa')
    expect(screen.getByLabelText('Cantidad (fila 1)')).toHaveValue('2')
    expect(screen.getByLabelText('Costo por paquete (fila 1)')).toHaveValue('6762')
    expect(screen.getByText(/Gorra de béisbol con gato bordado/)).toBeInTheDocument()
  })

  it('columna Unid./paquete editable y valores derivados', async () => {
    const { onChange } = setup({ rows: [row({ cantidad: '1', unidades_por_paquete: '10', costo_paquete: '21595' })] })
    expect(screen.getByLabelText('Unid./paquete (fila 1)')).toHaveValue('10')
    expect(screen.getByTestId('derivado-a')).toHaveTextContent('10 unidades')
    expect(screen.getByTestId('derivado-a')).toHaveTextContent('$2.159,5 c/u')
    await userEvent.type(screen.getByLabelText('Unid./paquete (fila 1)'), '0')
    expect(onChange).toHaveBeenLastCalledWith('a', 'unidades_por_paquete', '100')
  })

  it('muestra lista y promo leidas como ayuda de revision', () => {
    setup({ rows: [row({ precio_lista_texto: 'ARS44.635', precio_promo_texto: 'ARS21.595' })] })
    expect(screen.getByText('lista: ARS44.635 · promo: ARS21.595')).toBeInTheDocument()
  })

  it('sin promo muestra un guion', () => {
    setup({ rows: [row({ precio_lista_texto: 'ARS2.676', precio_promo_texto: '' })] })
    expect(screen.getByText('lista: ARS2.676 · promo: —')).toBeInTheDocument()
  })

  it('sin textos leidos no muestra nada', () => {
    setup()
    expect(screen.queryByText(/lista:/)).not.toBeInTheDocument()
  })

  it('resalta las filas con alerta_precio y explica por que', () => {
    setup({ rows: [row({ alerta_precio: true, precio_lista_texto: 'ARS4.944', precio_promo_texto: 'ARS9.494' })] })
    expect(screen.getByRole('listitem')).toHaveClass('purchase-row-alert')
    expect(screen.getByText(/revisá el precio/i)).toBeInTheDocument()
  })

  it('muestra el aviso de posible duplicado (parte superpuesta de la captura)', () => {
    setup({ rows: [row({ posible_duplicado: true })] })
    expect(screen.getByText('Posible duplicado (parte superpuesta de la captura): revisalo y borrá uno si corresponde.')).toBeInTheDocument()
    expect(screen.getByRole('listitem')).toHaveClass('purchase-row-alert')
  })

  it('aviso suave cuando solo coinciden los precios (articulo posiblemente cortado)', () => {
    setup({ rows: [row({ posible_duplicado: true, duplicado_motivo: 'precio' })] })
    expect(screen.getByText('Posible duplicado: mismo precio que un producto de la parte anterior de la captura (puede estar cortado). Revisalo.')).toBeInTheDocument()
    expect(screen.queryByText(/parte superpuesta/)).not.toBeInTheDocument()
  })

  it('sin posible_duplicado no hay aviso', () => {
    setup()
    expect(screen.queryByText(/Posible duplicado/)).not.toBeInTheDocument()
  })

  it('sin alerta no resalta', () => {
    setup()
    expect(screen.getByRole('listitem')).not.toHaveClass('purchase-row-alert')
  })

  it('sin derivados si la fila es invalida', () => {
    setup({ rows: [row({ unidades_por_paquete: '0' })] })
    expect(screen.queryByTestId('derivado-a')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Unid./paquete (fila 1)')).toHaveAttribute('aria-invalid', 'true')
  })

  it('editar un campo llama onChange(id, campo, valor)', async () => {
    const { onChange } = setup()
    await userEvent.type(screen.getByLabelText('Nombre (fila 1)'), 'X')
    expect(onChange).toHaveBeenLastCalledWith('a', 'nombre', 'Gorra gatoX')
  })

  it('borrar llama onDelete(id) con un boton real', async () => {
    const { onDelete } = setup()
    await userEvent.click(screen.getByRole('button', { name: 'Eliminar fila 1' }))
    expect(onDelete).toHaveBeenCalledWith('a')
  })

  it('badge Existe, sin input de precio de venta', () => {
    setup()
    expect(screen.getByText('Existe')).toBeInTheDocument()
    expect(screen.queryByLabelText('Precio de venta (fila 1)')).not.toBeInTheDocument()
  })

  it('badge Nuevo muestra el input opcional de precio de venta', async () => {
    const { onChange } = setup({ matches: { 'gorra gato': { status: 'nuevo' } } })
    expect(screen.getByText('Nuevo')).toBeInTheDocument()
    await userEvent.type(screen.getByLabelText('Precio de venta (fila 1)'), '9')
    expect(onChange).toHaveBeenLastCalledWith('a', 'precio_venta', '9')
  })

  it('estados verificando y sin verificar', () => {
    setup({ rows: [row(), row({ id: 'b', nombre: 'Otro' })], matches: { 'gorra gato': { status: 'pending' }, otro: { status: 'error' } } })
    expect(screen.getByText('Verificando…')).toBeInTheDocument()
    expect(screen.getByText('Sin verificar')).toBeInTheDocument()
  })

  it('muestra errores inline y marca aria-invalid', () => {
    setup({ rows: [row({ cantidad: '0', costo_paquete: '', nombre: '' })] })
    expect(screen.getByLabelText('Cantidad (fila 1)')).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByLabelText('Costo por paquete (fila 1)')).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByLabelText('Nombre (fila 1)')).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByText('Entero mayor o igual a 1')).toBeInTheDocument()
  })

  it('muestra el error devuelto por el servidor para la fila', () => {
    setup({ rowErrors: { a: 'Producto no encontrado: Gorra gato' } })
    expect(within(screen.getByRole('listitem')).getByRole('alert')).toHaveTextContent('Producto no encontrado')
  })
})
