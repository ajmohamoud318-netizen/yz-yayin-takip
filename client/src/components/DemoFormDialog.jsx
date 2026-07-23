import SpecFormDialog from '@/components/SpecFormDialog'

/**
 * Demo spec-sheet dialog — thin wrapper around the shared SpecFormDialog.
 * See SpecFormDialog.jsx (VARIANTS.demo) for all demo-specific behavior.
 */
export default function DemoFormDialog({ mode = 'advance', ...props }) {
  return <SpecFormDialog variant="demo" mode={mode} {...props} />
}
