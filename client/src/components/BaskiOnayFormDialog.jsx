import SpecFormDialog from '@/components/SpecFormDialog'

/**
 * Baskı Onay Formu dialog — thin wrapper around the shared SpecFormDialog.
 * See SpecFormDialog.jsx (VARIANTS.baski_onay) for all baski_onay-specific
 * behavior.
 */
export default function BaskiOnayFormDialog({ mode = 'approve', ...props }) {
  return <SpecFormDialog variant="baski_onay" mode={mode} {...props} />
}
