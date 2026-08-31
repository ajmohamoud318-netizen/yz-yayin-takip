import pg from 'pg'

const pool = new pg.Pool({
  connectionString: 'postgres://postgres:postgres@localhost:5432/yz_test_bug',
})

async function main() {
  try {
    // Test 1: Pass JS array, no JSON cast
    const value1 = [{ id: 'L1', role: 'team_leader', name: 'Ayşenur', at: '2026-08-31T13:35:57.262Z' }]
    const r1 = await pool.query(
      `UPDATE projects SET ozalit_approvals = $1 WHERE id = 'p-HvCL9xbF4oJk41wg' RETURNING ozalit_approvals`,
      [value1],
    )
    console.log('Test 1 (JS array direct):', r1.rows[0])
    
    // Test 2: Pass JSON string
    const value2 = JSON.stringify(value1)
    const r2 = await pool.query(
      `UPDATE projects SET ozalit_approvals = $1::jsonb WHERE id = 'p-HvCL9xbF4oJk41wg' RETURNING ozalit_approvals`,
      [value2],
    )
    console.log('Test 2 (JSON string with cast):', r2.rows[0])
    
    // Test 3: Empty array
    const r3 = await pool.query(
      `UPDATE projects SET ozalit_approvals = $1 WHERE id = 'p-HvCL9xbF4oJk41wg' RETURNING ozalit_approvals`,
      [[]],
    )
    console.log('Test 3 (empty array):', r3.rows[0])
  } catch (err) {
    console.error('ERROR:', err.message)
  } finally {
    await pool.end()
  }
}

main()
