import { Link } from "react-router-dom";

function Navbar() {
  return (
    <div className="navBarWrapper">
      <nav>
        <Link to="/">Home</Link>
        <Link to="/Dashboard">Dashboard</Link>
      </nav>
    </div>
  );
}

export default Navbar;
